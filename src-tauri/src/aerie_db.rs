//! Aerie's single-file SQLite store: `%APPDATA%\PILLAR\aerie.db`, next to PILLAR's
//! settings.json. Everything Aerie keeps (snippets, clipboard history, voice memo
//! list, ...) lives here, so a backup is one file plus the `clips\` and `voice\` folders.
//!
//! Generic tables (`kv`, `docs`) serve simple tools; features that need search or
//! indexing (clipboard history) get their own table via a new migration.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

/// Reject absurd payloads so a UI bug cannot bloat the database.
pub const MAX_VALUE_BYTES: usize = 2 * 1024 * 1024;

pub struct Db(pub Mutex<Connection>);

/// Append only: index + 1 is the `user_version` after that migration ran.
const MIGRATIONS: &[&str] = &[
    // v1: generic stores
    "CREATE TABLE kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE docs (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        json       TEXT NOT NULL,
        updated    INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
    );",
    // v2: clipboard history
    "CREATE TABLE clips (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT NOT NULL,          -- text | link | image | files
        text       TEXT,                   -- text/link body, or newline-joined file paths
        image_file TEXT,                   -- file name under clips\\ for images
        hash       TEXT NOT NULL UNIQUE,   -- content hash: copying again moves it to the top
        source_app TEXT,                   -- exe name of the app that copied it
        pinned     INTEGER NOT NULL DEFAULT 0,
        created    INTEGER NOT NULL,
        last_used  INTEGER NOT NULL
    );
    CREATE INDEX clips_recent ON clips (pinned DESC, last_used DESC);",
];

/// `%APPDATA%\PILLAR`, the folder PILLAR already uses for settings.json.
pub fn data_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    Path::new(&app_data).join("PILLAR")
}

pub fn open(path: &Path) -> rusqlite::Result<Db> {
    let conn = Connection::open(path)?;
    configure_and_migrate(&conn)?;
    Ok(Db(Mutex::new(conn)))
}

fn configure_and_migrate(conn: &Connection) -> rusqlite::Result<()> {
    // secure_delete overwrites deleted rows with zeros, so "deleted" means gone.
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 2000;")?;
    let current: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        conn.execute_batch(&format!("BEGIN; {sql} PRAGMA user_version = {}; COMMIT;", i + 1))?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn err(e: impl ToString) -> String {
    e.to_string()
}

fn check_size(value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES {
        Err("value too large".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn aerie_kv_get(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(err)?;
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [&key], |r| r.get(0))
        .optional()
        .map_err(err)
}

#[tauri::command]
pub fn aerie_kv_set(db: State<Db>, key: String, value: String) -> Result<(), String> {
    check_size(&value)?;
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&key, &value],
    )
    .map_err(err)?;
    Ok(())
}

#[derive(Serialize)]
pub struct DocRow {
    id: String,
    json: String,
    updated: i64,
}

#[tauri::command]
pub fn aerie_docs_list(db: State<Db>, collection: String) -> Result<Vec<DocRow>, String> {
    let conn = db.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, json, updated FROM docs WHERE collection = ?1 ORDER BY updated DESC")
        .map_err(err)?;
    let rows = stmt
        .query_map([&collection], |r| Ok(DocRow { id: r.get(0)?, json: r.get(1)?, updated: r.get(2)? }))
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[tauri::command]
pub fn aerie_doc_put(db: State<Db>, collection: String, id: String, json: String) -> Result<(), String> {
    check_size(&json)?;
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("invalid JSON: {e}"))?;
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "INSERT INTO docs (collection, id, json, updated) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json, updated = excluded.updated",
        rusqlite::params![collection, id, json, now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn aerie_doc_delete(db: State<Db>, collection: String, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute("DELETE FROM docs WHERE collection = ?1 AND id = ?2", [&collection, &id])
        .map_err(err)?;
    Ok(())
}

#[cfg(test)]
pub fn open_in_memory() -> Db {
    let conn = Connection::open_in_memory().unwrap();
    configure_and_migrate(&conn).unwrap();
    Db(Mutex::new(conn))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_once_and_set_version() {
        let db = open_in_memory();
        let conn = db.0.lock().unwrap();
        let v: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(v, MIGRATIONS.len());
        // Running again is a no-op, not an error ("table already exists").
        configure_and_migrate(&conn).unwrap();
        for table in ["kv", "docs", "clips"] {
            let n: i64 = conn
                .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", [table], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "{table} missing");
        }
    }

    #[test]
    fn secure_delete_is_on() {
        let db = open_in_memory();
        let conn = db.0.lock().unwrap();
        let on: i64 = conn.pragma_query_value(None, "secure_delete", |r| r.get(0)).unwrap();
        assert_eq!(on, 1);
    }
}
