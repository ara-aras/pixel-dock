//! Voice memos: audio is recorded in the webview (MediaRecorder, WebM/Opus) and
//! streamed here in chunks, so a crash mid-recording keeps what was captured and no
//! single IPC message is huge. Files live in `%APPDATA%\PILLAR\voice\`; the list of
//! memos is a `docs` collection ("voice") managed by the frontend.

use std::io::Write;
use std::path::PathBuf;

use crate::aerie_db::{data_dir, err};

/// ~2 hours of Opus at 32 kbit/s, with headroom.
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

pub fn voice_dir() -> PathBuf {
    data_dir().join("voice")
}

/// Only names we generate are accepted: `<uuid-ish>.webm`. Rejects paths and traversal.
pub fn safe_file_name(name: &str) -> Result<&str, String> {
    let stem = name.strip_suffix(".webm").unwrap_or("");
    let ok = !stem.is_empty()
        && name.len() <= 80
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(name)
    } else {
        Err("invalid voice file name".into())
    }
}

fn path_for(file: &str) -> Result<PathBuf, String> {
    Ok(voice_dir().join(safe_file_name(file)?))
}

/// Append a base64 chunk to a recording, creating the file on the first chunk.
#[tauri::command]
pub fn aerie_voice_append(file: String, chunk: String) -> Result<u64, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(chunk).map_err(err)?;
    std::fs::create_dir_all(voice_dir()).map_err(err)?;
    let path = path_for(&file)?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size + bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("recording too long".into());
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(err)?;
    f.write_all(&bytes).map_err(err)?;
    Ok(size + bytes.len() as u64)
}

/// A memo as a `data:` URL for the <audio> player.
#[tauri::command]
pub fn aerie_voice_load(file: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(path_for(&file)?).map_err(err)?;
    Ok(format!("data:audio/webm;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn aerie_voice_delete(file: String) -> Result<(), String> {
    match std::fs::remove_file(path_for(&file)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Open Explorer with the memo selected.
#[tauri::command]
pub fn aerie_voice_reveal(file: String) -> Result<(), String> {
    let path = path_for(&file)?;
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_generated_names_are_accepted() {
        assert!(safe_file_name("3f2a9c1e-77b0-4c1d-9a2e-0b1c2d3e4f50.webm").is_ok());
        for bad in ["../x.webm", "a/b.webm", "C:\\x.webm", "x.exe", ".webm", "a b.webm", "x.webm.exe"] {
            assert!(safe_file_name(bad).is_err(), "{bad} should be rejected");
        }
    }
}
