//! Clipboard history: a background thread watches the Windows clipboard and stores
//! text, links, file lists and images in `aerie.db` (images as files in `clips\`).
//!
//! Privacy, checked before anything is read or stored:
//! - copies from known password managers are never recorded;
//! - copies an app marks private through Windows' own clipboard flags are skipped
//!   (`ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory = 0`,
//!   `Clipboard Viewer Ignore`), the same signals Windows' own Win+V history honours;
//! - any app on the user's "never record" list is skipped;
//! - recording can be paused.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::aerie_db::{self, err, now_ms, Db};

/// Emitted (no payload) whenever the stored history changes.
pub const CLIPS_CHANGED: &str = "aerie://clips-changed";

/// Executables whose copies are never recorded (lower-case file names).
const PASSWORD_MANAGERS: &[&str] = &[
    "keepass.exe",
    "keepassxc.exe",
    "bitwarden.exe",
    "1password.exe",
    "lastpass.exe",
    "dashlane.exe",
    "nordpass.exe",
    "enpass.exe",
    "roboform.exe",
    "robotaskbaricon.exe",
    "proton pass.exe",
    "protonpass.exe",
];

/// Text over this size is skipped, never stored cut short.
const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;
/// Images over this size (as BMP bytes) are skipped.
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
/// Search looks at the first N characters of each clip.
const SEARCH_CHARS: i64 = 50_000;

pub const DEFAULT_MAX_ITEMS: i64 = 500;
pub const DEFAULT_MAX_DAYS: i64 = 30;

#[derive(Debug, Clone, PartialEq)]
pub enum Content {
    Text(String),
    Files(Vec<String>),
    /// A complete BMP file, as produced by the clipboard's DIB data.
    Image(Vec<u8>),
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/// FNV-1a, 64-bit. Stable across Rust versions (unlike std's hasher), so stored
/// hashes keep matching after an upgrade.
pub fn fnv1a(parts: &[&[u8]]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for part in parts {
        for b in *part {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        h ^= 0xff; // separator so ["ab","c"] != ["a","bc"]
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// A single http(s) URL with no spaces counts as a link.
pub fn is_link(text: &str) -> bool {
    let t = text.trim();
    (t.starts_with("http://") || t.starts_with("https://"))
        && t.len() > 10
        && !t.chars().any(char::is_whitespace)
}

/// True when copies from `exe` must not be recorded.
pub fn is_blocked_source(exe: Option<&str>, never_record: &[String]) -> bool {
    let Some(exe) = exe else { return false };
    let exe = exe.to_lowercase();
    PASSWORD_MANAGERS.contains(&exe.as_str()) || never_record.iter().any(|n| n.eq_ignore_ascii_case(&exe))
}

/// Dedupe hash of captured content (same value `store` uses for the UNIQUE column).
pub fn content_hash(content: &Content) -> String {
    match content {
        Content::Text(text) => fnv1a(&[b"text", text.as_bytes()]),
        Content::Files(paths) => fnv1a(&[b"files", paths.join("\n").as_bytes()]),
        Content::Image(bytes) => fnv1a(&[b"image", bytes]),
    }
}

/// Remembers the last copy we refused because of its source app. Windows often
/// announces the same data twice: once from the app, then again when OLE flushes
/// the clipboard as the app exits, by which time the owner is gone (source
/// unknown). Without this the second announcement would record the secret.
///
/// The same type also drops plain repeats: one .NET/OLE copy can raise two or
/// three clipboard updates, which would otherwise be sent to the phone (and the
/// paste stack) once per update.
pub struct RecentHash {
    last: Option<(String, i64)>,
    window_ms: i64,
}

impl RecentHash {
    pub fn new(window_ms: i64) -> Self {
        Self { last: None, window_ms }
    }
    pub fn remember(&mut self, hash: String, now: i64) {
        self.last = Some((hash, now));
    }
    pub fn is_echo(&self, hash: &str, now: i64) -> bool {
        matches!(&self.last, Some((h, t)) if h == hash && now - t <= self.window_ms)
    }
}

pub struct NewClip<'a> {
    pub kind: &'a str,
    pub text: Option<&'a str>,
    pub image_file: Option<&'a str>,
    pub hash: &'a str,
    pub source_app: Option<&'a str>,
    pub now: i64,
}

/// Insert a clip, or move an identical one back to the top.
pub fn upsert_clip(conn: &Connection, c: &NewClip) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO clips (kind, text, image_file, hash, source_app, pinned, created, last_used)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
         ON CONFLICT(hash) DO UPDATE SET last_used = excluded.last_used,
                                         source_app = COALESCE(excluded.source_app, clips.source_app)",
        params![c.kind, c.text, c.image_file, c.hash, c.source_app, c.now],
    )?;
    conn.query_row("SELECT id FROM clips WHERE hash = ?1", [c.hash], |r| r.get(0))
}

/// Enforce retention on unpinned clips. `max_days <= 0` keeps them forever.
/// Returns image file names that are no longer referenced, for the caller to delete.
pub fn prune(conn: &Connection, max_items: i64, max_days: i64, now: i64) -> rusqlite::Result<Vec<String>> {
    let cutoff = if max_days > 0 { now - max_days * 86_400_000 } else { i64::MIN };
    let condition = "pinned = 0 AND (last_used < ?1 OR id NOT IN (
                        SELECT id FROM clips WHERE pinned = 0 ORDER BY last_used DESC LIMIT ?2))";
    let mut stmt = conn.prepare(&format!("SELECT image_file FROM clips WHERE {condition} AND image_file IS NOT NULL"))?;
    let files = stmt
        .query_map(params![cutoff, max_items.max(0)], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    conn.execute(&format!("DELETE FROM clips WHERE {condition}"), params![cutoff, max_items.max(0)])?;
    Ok(files)
}

fn kv_i64(conn: &Connection, key: &str, default: i64) -> i64 {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

fn kv_list(conn: &Connection, key: &str) -> Vec<String> {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default()
}

pub fn clips_dir() -> PathBuf {
    aerie_db::data_dir().join("clips")
}

/// Store captured content. Returns the clip's id, or None when it was skipped.
pub fn store(conn: &Connection, content: &Content, source_app: Option<&str>, now: i64) -> Result<Option<i64>, String> {
    if kv_i64(conn, "clip.paused", 0) != 0 {
        return Ok(None);
    }
    if is_blocked_source(source_app, &kv_list(conn, "clip.never_record")) {
        return Ok(None);
    }
    let id = match content {
        Content::Text(text) => {
            if text.trim().is_empty() || text.len() > MAX_TEXT_BYTES {
                return Ok(None);
            }
            let kind = if is_link(text) { "link" } else { "text" };
            let hash = content_hash(content);
            upsert_clip(conn, &NewClip { kind, text: Some(text), image_file: None, hash: &hash, source_app, now })
                .map_err(err)?
        }
        Content::Files(paths) => {
            if paths.is_empty() {
                return Ok(None);
            }
            let joined = paths.join("\n");
            let hash = content_hash(content);
            upsert_clip(conn, &NewClip { kind: "files", text: Some(&joined), image_file: None, hash: &hash, source_app, now })
                .map_err(err)?
        }
        Content::Image(bytes) => {
            if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
                return Ok(None);
            }
            let hash = content_hash(content);
            let file = format!("{hash}.bmp");
            let dir = clips_dir();
            std::fs::create_dir_all(&dir).map_err(err)?;
            let path = dir.join(&file);
            if !path.exists() {
                std::fs::write(&path, bytes).map_err(err)?;
            }
            upsert_clip(conn, &NewClip { kind: "image", text: None, image_file: Some(&file), hash: &hash, source_app, now })
                .map_err(err)?
        }
    };
    let orphaned = prune(
        conn,
        kv_i64(conn, "clip.max_items", DEFAULT_MAX_ITEMS),
        kv_i64(conn, "clip.max_days", DEFAULT_MAX_DAYS),
        now,
    )
    .map_err(err)?;
    remove_image_files(&orphaned);
    Ok(Some(id))
}

fn remove_image_files(files: &[String]) {
    for f in files {
        // Only plain file names we generated; never follow a path from the database.
        if Path::new(f).file_name().map(|n| n == f.as_str()).unwrap_or(false) {
            let _ = std::fs::remove_file(clips_dir().join(f));
        }
    }
}

// ---------------------------------------------------------------------------
// Windows clipboard access
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod win {
    use super::Content;
    use clipboard_win::{raw, Clipboard};

    const CF_UNICODETEXT: u32 = 13;
    const CF_HDROP: u32 = 15;
    const CF_DIB: u32 = 8;
    const CF_DIBV5: u32 = 17;

    fn format_present(name: &str) -> Option<u32> {
        raw::register_format(name).map(|f| f.get()).filter(|f| raw::is_format_avail(*f))
    }

    /// Windows' own "don't record this" signals (honoured by Win+V history too).
    /// Must be called with the clipboard open.
    fn marked_private() -> bool {
        if format_present("ExcludeClipboardContentFromMonitorProcessing").is_some()
            || format_present("Clipboard Viewer Ignore").is_some()
        {
            return true;
        }
        if let Some(fmt) = format_present("CanIncludeInClipboardHistory") {
            let mut buf = [0u8; 4];
            if raw::get(fmt, &mut buf).unwrap_or(0) >= 4 && u32::from_le_bytes(buf) == 0 {
                return true;
            }
        }
        false
    }

    /// Read the clipboard. None when it is private, empty or an unsupported format.
    pub fn read() -> Option<Content> {
        let _open = Clipboard::new_attempts(10).ok()?;
        if marked_private() {
            return None;
        }
        if raw::is_format_avail(CF_HDROP) {
            let mut files = Vec::new();
            if raw::get_file_list(&mut files).is_ok() && !files.is_empty() {
                return Some(Content::Files(files));
            }
        }
        if raw::is_format_avail(CF_UNICODETEXT) {
            let mut bytes = Vec::new();
            if raw::get_string(&mut bytes).is_ok() {
                return String::from_utf8(bytes).ok().map(Content::Text);
            }
        }
        if raw::is_format_avail(CF_DIB) || raw::is_format_avail(CF_DIBV5) {
            let mut bmp = Vec::new();
            if raw::get_bitmap(&mut bmp).is_ok() && !bmp.is_empty() {
                return Some(Content::Image(bmp));
            }
        }
        None
    }

    pub fn write(content: &Content) -> Result<(), String> {
        let _open = Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
        match content {
            Content::Text(t) => raw::set_string(t),
            Content::Files(f) => raw::set_file_list(f),
            Content::Image(b) => raw::set_bitmap(b),
        }
        .map_err(|e| e.to_string())
    }

    /// Lower-case exe name of the app that owns the clipboard (the copier).
    pub fn owner_exe() -> Option<String> {
        use windows::core::PWSTR;
        use windows::Win32::Foundation::{CloseHandle, HWND};
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

        let owner = clipboard_win::get_owner()?;
        // SAFETY: plain Win32 queries on a handle we own and close.
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(HWND(owner.as_ptr()), Some(&mut pid));
            if pid == 0 {
                return None;
            }
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(process);
            ok.ok()?;
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            std::path::Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
        }
    }
}

/// Start the background watcher. Each clipboard change is read, filtered and stored.
#[cfg(target_os = "windows")]
pub fn start_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("aerie-clipboard".into())
        .spawn(move || {
            let mut monitor = match clipboard_win::Monitor::new() {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("[AERIE] clipboard watcher unavailable: {e}");
                    return;
                }
            };
            let mut blocked_echo = RecentHash::new(5_000);
            let mut repeat = RecentHash::new(1_500);
            loop {
                match monitor.recv() {
                    Ok(true) => {
                        // Who copied it: ask now, before the wait. GetClipboardOwner does
                        // not open the clipboard, and a short-lived copier (a CLI, a
                        // password manager's helper) may be gone 200 ms later, which would
                        // leave the source unknown and skip the never-record check.
                        let early_source = win::owner_exe();
                        // Let the copying app finish writing all its formats before we
                        // open the clipboard. Reading too soon makes the copier's own
                        // follow-up clipboard calls fail (seen with PowerShell/.NET at 60 ms).
                        std::thread::sleep(std::time::Duration::from_millis(200));
                        let source = early_source.or_else(win::owner_exe);
                        if let Some(content) = win::read() {
                            let now = now_ms();
                            let hash = content_hash(&content);
                            if blocked_echo.is_echo(&hash, now) || repeat.is_echo(&hash, now) {
                                continue;
                            }
                            repeat.remember(hash.clone(), now);
                            let db = app.state::<Db>();
                            let stored = db.0.lock().map_err(err).and_then(|conn| {
                                if is_blocked_source(source.as_deref(), &kv_list(&conn, "clip.never_record")) {
                                    blocked_echo.remember(hash.clone(), now);
                                    return Ok(None);
                                }
                                store(&conn, &content, source.as_deref(), now)
                            });
                            match stored {
                                Ok(Some(id)) => {
                                    let _ = app.emit(CLIPS_CHANGED, ());
                                    // Paste stack in "collect" mode takes every new copy.
                                    crate::aerie_stack::on_new_clip(&app, id);
                                    // Phone link: send text copies to the paired phone.
                                    if let Content::Text(text) = &content {
                                        crate::aerie_phone::on_local_text(&app, text);
                                    }
                                }
                                Ok(None) => {}
                                Err(e) => eprintln!("[AERIE] could not store clip: {e}"),
                            }
                        }
                    }
                    Ok(false) => {}
                    Err(e) => {
                        eprintln!("[AERIE] clipboard watcher stopped: {e}");
                        return;
                    }
                }
            }
        })
        .ok();
}

#[cfg(not(target_os = "windows"))]
pub fn start_watcher(_app: AppHandle) {}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ClipRow {
    id: i64,
    kind: String,
    /// First 2000 characters (full text via aerie_clip_text).
    preview: Option<String>,
    length: i64,
    image_file: Option<String>,
    source_app: Option<String>,
    pinned: bool,
    created: i64,
    last_used: i64,
}

#[tauri::command]
pub fn aerie_clips_list(
    db: State<Db>,
    query: Option<String>,
    kind: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ClipRow>, String> {
    let conn = db.0.lock().map_err(err)?;
    let q = query.unwrap_or_default().to_lowercase();
    let kind = kind.unwrap_or_default();
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, substr(text, 1, 2000), length(text), image_file, source_app, pinned, created, last_used
             FROM clips
             WHERE (?1 = '' OR instr(lower(substr(text, 1, ?4)), ?1) > 0)
               AND (?2 = '' OR kind = ?2)
             ORDER BY pinned DESC, last_used DESC
             LIMIT ?3",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![q, kind, limit.unwrap_or(200).clamp(1, 5000), SEARCH_CHARS], |r| {
            Ok(ClipRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                preview: r.get(2)?,
                length: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                image_file: r.get(4)?,
                source_app: r.get(5)?,
                pinned: r.get::<_, i64>(6)? != 0,
                created: r.get(7)?,
                last_used: r.get(8)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

fn load_content(conn: &Connection, id: i64) -> Result<Content, String> {
    let (kind, text, image): (String, Option<String>, Option<String>) = conn
        .query_row("SELECT kind, text, image_file FROM clips WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(err)?;
    match kind.as_str() {
        "files" => Ok(Content::Files(text.unwrap_or_default().lines().map(String::from).collect())),
        "image" => {
            let file = image.ok_or("image missing")?;
            std::fs::read(clips_dir().join(file)).map(Content::Image).map_err(err)
        }
        _ => Ok(Content::Text(text.unwrap_or_default())),
    }
}

/// Full text of a clip (text, link or file list).
#[tauri::command]
pub fn aerie_clip_text(db: State<Db>, id: i64) -> Result<String, String> {
    let conn = db.0.lock().map_err(err)?;
    match load_content(&conn, id)? {
        Content::Text(t) => Ok(t),
        Content::Files(f) => Ok(f.join("\n")),
        Content::Image(_) => Err("clip is an image".into()),
    }
}

/// Put a clip back on the clipboard and move it to the top.
#[tauri::command]
pub fn aerie_clip_copy(db: State<Db>, id: i64) -> Result<(), String> {
    let content = {
        let conn = db.0.lock().map_err(err)?;
        conn.execute("UPDATE clips SET last_used = ?2 WHERE id = ?1", params![id, now_ms()])
            .map_err(err)?;
        load_content(&conn, id)?
    };
    write_clipboard(&content)
}

/// Write arbitrary text to the clipboard (snippets, calculator results, ...).
#[tauri::command]
pub fn aerie_clipboard_write_text(text: String) -> Result<(), String> {
    write_clipboard(&Content::Text(text))
}

/// Put files on the clipboard as a file list (Shelf "Copy"), like Explorer's copy.
#[tauri::command]
pub fn aerie_clipboard_write_files(paths: Vec<String>) -> Result<(), String> {
    let existing: Vec<String> = paths.into_iter().filter(|p| Path::new(p).exists()).collect();
    if existing.is_empty() {
        return Err("none of those files exist any more".into());
    }
    write_clipboard(&Content::Files(existing))
}

/// Which of these paths still exist (Shelf items whose originals were moved or deleted).
#[tauri::command]
pub fn aerie_paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).exists()).collect()
}

/// Read the clipboard's current text, if any ({clipboard} placeholder in snippets).
#[tauri::command]
pub fn aerie_clipboard_read_text() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        match win::read() {
            Some(Content::Text(t)) => Some(t),
            _ => None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    None
}

fn write_clipboard(content: &Content) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win::write(content)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = content;
        Err("clipboard not supported on this platform".into())
    }
}

#[tauri::command]
pub fn aerie_clip_set_pinned(app: AppHandle, db: State<Db>, id: i64, pinned: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute("UPDATE clips SET pinned = ?2 WHERE id = ?1", params![id, pinned as i64])
        .map_err(err)?;
    let _ = app.emit(CLIPS_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub fn aerie_clip_delete(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    let image: Option<String> = conn
        .query_row("SELECT image_file FROM clips WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(err)?
        .flatten();
    conn.execute("DELETE FROM clips WHERE id = ?1", [id]).map_err(err)?;
    if let Some(file) = image {
        let still_used: i64 = conn
            .query_row("SELECT count(*) FROM clips WHERE image_file = ?1", [&file], |r| r.get(0))
            .map_err(err)?;
        if still_used == 0 {
            remove_image_files(&[file]);
        }
    }
    let _ = app.emit(CLIPS_CHANGED, ());
    Ok(())
}

/// Delete every unpinned clip.
#[tauri::command]
pub fn aerie_clips_clear(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    let orphaned = prune(&conn, 0, 0, now_ms()).map_err(err)?;
    remove_image_files(&orphaned);
    let _ = app.emit(CLIPS_CHANGED, ());
    Ok(())
}

/// An image clip as a `data:` URL for display.
#[tauri::command]
pub fn aerie_clip_image(db: State<Db>, id: i64) -> Result<String, String> {
    use base64::Engine;
    let conn = db.0.lock().map_err(err)?;
    match load_content(&conn, id)? {
        Content::Image(bytes) => Ok(format!(
            "data:image/bmp;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )),
        _ => Err("clip is not an image".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aerie_db::open_in_memory;

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT count(*) FROM clips", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn hash_is_stable_and_separates_parts() {
        assert_eq!(fnv1a(&[b"text", b"hello"]), fnv1a(&[b"text", b"hello"]));
        assert_ne!(fnv1a(&[b"ab", b"c"]), fnv1a(&[b"a", b"bc"]));
        assert_eq!(fnv1a(&[b"text", b"hello"]).len(), 16);
    }

    #[test]
    fn link_detection() {
        assert!(is_link("https://example.com/a?b=c"));
        assert!(is_link("  http://x.org/path  "));
        assert!(!is_link("see https://example.com"));
        assert!(!is_link("ftp://example.com/file"));
        assert!(!is_link("https://"));
    }

    #[test]
    fn password_managers_and_never_record_list_are_blocked() {
        assert!(is_blocked_source(Some("KeePassXC.exe"), &[]));
        assert!(is_blocked_source(Some("bitwarden.exe"), &[]));
        assert!(is_blocked_source(Some("notes.exe"), &["Notes.exe".into()]));
        assert!(!is_blocked_source(Some("chrome.exe"), &[]));
        assert!(!is_blocked_source(None, &[]));
    }

    #[test]
    fn copying_again_moves_to_top_instead_of_duplicating() {
        let db = open_in_memory();
        let conn = db.0.lock().unwrap();
        assert!(store(&conn, &Content::Text("one".into()), Some("a.exe"), 1).unwrap().is_some());
        assert!(store(&conn, &Content::Text("two".into()), Some("a.exe"), 2).unwrap().is_some());
        assert!(store(&conn, &Content::Text("one".into()), Some("b.exe"), 3).unwrap().is_some());
        assert_eq!(count(&conn), 2);
        let (top, src): (String, String) = conn
            .query_row("SELECT text, source_app FROM clips ORDER BY last_used DESC LIMIT 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!((top.as_str(), src.as_str()), ("one", "b.exe"));
    }

    #[test]
    fn skips_blocked_paused_and_empty() {
        let db = open_in_memory();
        let conn = db.0.lock().unwrap();
        assert!(store(&conn, &Content::Text("secret".into()), Some("1Password.exe"), 1).unwrap().is_none());
        assert!(store(&conn, &Content::Text("   ".into()), None, 1).unwrap().is_none());
        let mut echo = RecentHash::new(5_000);
        let h = content_hash(&Content::Text("secret".into()));
        assert!(!echo.is_echo(&h, 0));
        echo.remember(h.clone(), 1_000);
        assert!(echo.is_echo(&h, 3_000), "re-announcement right after a block is skipped");
        assert!(!echo.is_echo(&h, 7_000), "same text copied much later is a new copy");
        assert!(!echo.is_echo(&content_hash(&Content::Text("other".into())), 2_000));
        conn.execute("INSERT INTO kv (key, value) VALUES ('clip.paused', '1')", []).unwrap();
        assert!(store(&conn, &Content::Text("hello".into()), None, 1).unwrap().is_none());
        assert_eq!(count(&conn), 0);
    }

    #[test]
    fn classifies_links_and_files() {
        let db = open_in_memory();
        let conn = db.0.lock().unwrap();
        store(&conn, &Content::Text("https://a.dev/x".into()), None, 1).unwrap();
        store(&conn, &Content::Files(vec!["C:\\a.txt".into(), "C:\\b.txt".into()]), None, 2).unwrap();
        let kinds: Vec<String> = conn
            .prepare("SELECT kind FROM clips ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(kinds, ["link", "files"]);
    }

    #[test]
    fn prune_keeps_pinned_and_respects_count_and_age() {
        let db = open_in_memory();
        let conn = db.0.lock().unwrap();
        let day = 86_400_000;
        for (i, t) in ["a", "b", "c", "d"].iter().enumerate() {
            upsert_clip(&conn, &NewClip { kind: "text", text: Some(t), image_file: None, hash: t, source_app: None, now: i as i64 * day }).unwrap();
        }
        conn.execute("UPDATE clips SET pinned = 1 WHERE text = 'a'", []).unwrap();
        // Keep 2 newest unpinned (c, d); 'a' survives because it is pinned.
        prune(&conn, 2, 0, 10 * day).unwrap();
        let left: Vec<String> = conn
            .prepare("SELECT text FROM clips ORDER BY text")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(left, ["a", "c", "d"]);
        // Age limit 7 days at now=10d: cutoff is day 3. c (day 2) is older and goes;
        // d (exactly day 3) is not older than the cutoff and stays.
        prune(&conn, 100, 7, 10 * day).unwrap();
        assert_eq!(count(&conn), 2);
        // A day later the cutoff passes d too; pinned a still stays.
        prune(&conn, 100, 7, 11 * day).unwrap();
        assert_eq!(count(&conn), 1);
    }
}
