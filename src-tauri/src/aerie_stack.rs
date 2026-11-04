//! Paste stack: collect several clips, then paste them one after another, in order.
//!
//! - Ctrl+Alt+C toggles "collect": every new copy is appended to the stack.
//! - Ctrl+Alt+V pastes the next item into the focused app and drops it from the stack.
//! - The Clipboard tab can also add any history item.
//!
//! The stack holds clip ids from the history table, kept in `kv` ("stack.items"),
//! so it survives restarts and never duplicates clip content.

use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::aerie_db::{err, Db};

pub const STACK_CHANGED: &str = "aerie://stack-changed";
const ITEMS_KEY: &str = "stack.items";
const COLLECT_KEY: &str = "stack.collecting";
const MAX_ITEMS: usize = 50;

/// Set while we write the clipboard ourselves, so our own write is not collected again.
static SUPPRESS_NEXT_COLLECT: AtomicBool = AtomicBool::new(false);

pub fn read_items(conn: &Connection) -> Vec<i64> {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [ITEMS_KEY], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default()
}

pub fn write_items(conn: &Connection, items: &[i64]) -> rusqlite::Result<()> {
    let json = serde_json::to_string(items).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [ITEMS_KEY, &json],
    )?;
    Ok(())
}

pub fn is_collecting(conn: &Connection) -> bool {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [COLLECT_KEY], |r| r.get::<_, String>(0))
        .map(|v| v == "1")
        .unwrap_or(false)
}

/// Append, skipping an immediate repeat of the last item; capped at MAX_ITEMS (oldest dropped).
pub fn push(items: &mut Vec<i64>, id: i64) {
    if items.last() == Some(&id) {
        return;
    }
    items.push(id);
    if items.len() > MAX_ITEMS {
        let excess = items.len() - MAX_ITEMS;
        items.drain(..excess);
    }
}

/// Called by the clipboard watcher for each newly stored clip.
pub fn on_new_clip(app: &AppHandle, id: i64) {
    if SUPPRESS_NEXT_COLLECT.swap(false, Ordering::SeqCst) {
        return;
    }
    let db = app.state::<Db>();
    let Ok(conn) = db.0.lock() else { return };
    if !is_collecting(&conn) {
        return;
    }
    let mut items = read_items(&conn);
    push(&mut items, id);
    if write_items(&conn, &items).is_ok() {
        drop(conn);
        let _ = app.emit(STACK_CHANGED, ());
    }
}

#[derive(Serialize)]
pub struct StackItem {
    id: i64,
    kind: String,
    preview: String,
}

#[derive(Serialize)]
pub struct StackState {
    collecting: bool,
    items: Vec<StackItem>,
}

fn state(conn: &Connection) -> StackState {
    let items = read_items(conn)
        .into_iter()
        .filter_map(|id| {
            conn.query_row(
                "SELECT kind, COALESCE(substr(text, 1, 200), '') FROM clips WHERE id = ?1",
                [id],
                |r| Ok(StackItem { id, kind: r.get(0)?, preview: r.get(1)? }),
            )
            .ok()
        })
        .collect();
    StackState { collecting: is_collecting(conn), items }
}

#[tauri::command]
pub fn aerie_stack_get(db: State<Db>) -> Result<StackState, String> {
    Ok(state(&*db.0.lock().map_err(err)?))
}

#[tauri::command]
pub fn aerie_stack_push(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    let mut items = read_items(&conn);
    push(&mut items, id);
    write_items(&conn, &items).map_err(err)?;
    let _ = app.emit(STACK_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub fn aerie_stack_remove(app: AppHandle, db: State<Db>, index: usize) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    let mut items = read_items(&conn);
    if index < items.len() {
        items.remove(index);
        write_items(&conn, &items).map_err(err)?;
    }
    let _ = app.emit(STACK_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub fn aerie_stack_clear(app: AppHandle, db: State<Db>) -> Result<(), String> {
    write_items(&*db.0.lock().map_err(err)?, &[]).map_err(err)?;
    let _ = app.emit(STACK_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub fn aerie_stack_set_collecting(app: AppHandle, db: State<Db>, collecting: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [COLLECT_KEY, if collecting { "1" } else { "0" }],
    )
    .map_err(err)?;
    let _ = app.emit(STACK_CHANGED, ());
    Ok(())
}

pub fn toggle_collecting(app: &AppHandle) {
    let db = app.state::<Db>();
    let next = match db.0.lock() {
        Ok(conn) => !is_collecting(&conn),
        Err(_) => return,
    };
    let _ = aerie_stack_set_collecting(app.clone(), app.state::<Db>(), next);
}

/// Take the first item, put it on the clipboard and press Ctrl+V in the focused app.
/// Runs on a worker thread because it waits for the user to release the hotkey.
pub fn paste_next(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let db = app.state::<Db>();
        let next = {
            let Ok(conn) = db.0.lock() else { return };
            let mut items = read_items(&conn);
            if items.is_empty() {
                return;
            }
            let id = items.remove(0);
            if write_items(&conn, &items).is_err() {
                return;
            }
            id
        };
        let _ = app.emit(STACK_CHANGED, ());
        SUPPRESS_NEXT_COLLECT.store(true, Ordering::SeqCst);
        if crate::aerie_clipboard::aerie_clip_copy(app.state::<Db>(), next).is_err() {
            SUPPRESS_NEXT_COLLECT.store(false, Ordering::SeqCst);
            return;
        }
        crate::aerie_input::send_paste_when_modifiers_released();
    });
}

#[tauri::command]
pub fn aerie_stack_paste_next(app: AppHandle) {
    paste_next(&app);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aerie_db::open_in_memory;

    #[test]
    fn push_skips_repeats_and_caps_length() {
        let mut items = vec![];
        push(&mut items, 1);
        push(&mut items, 1);
        push(&mut items, 2);
        push(&mut items, 1);
        assert_eq!(items, [1, 2, 1]);
        for i in 0..100 {
            push(&mut items, 1000 + i);
        }
        assert_eq!(items.len(), MAX_ITEMS);
        assert_eq!(*items.last().unwrap(), 1099);
    }

    #[test]
    fn items_round_trip_and_state_skips_deleted_clips() {
        let db = open_in_memory();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO clips (id, kind, text, hash, created, last_used) VALUES (7, 'text', 'hello', 'h', 1, 1)",
            [],
        )
        .unwrap();
        write_items(&conn, &[7, 99]).unwrap();
        assert_eq!(read_items(&conn), [7, 99]);
        let s = state(&conn);
        assert_eq!(s.items.len(), 1, "clip 99 no longer exists and is skipped");
        assert_eq!(s.items[0].preview, "hello");
        assert!(!s.collecting);
    }
}
