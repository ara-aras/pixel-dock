//! Single-file SQLite storage for all user data.
//!
//! Two generic tables keep the Rust surface small while tools are still changing:
//! - `kv`: one value per key (the scratch note, history lists, ...)
//! - `docs`: JSON documents grouped by collection (to-dos, snippets, ...)
//! Tools that outgrow this (clipboard history with search) get their own tables
//! through a new migration.

use std::{
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

/// Reject absurd payloads so a bug in the UI cannot bloat the database.
const MAX_VALUE_BYTES: usize = 2 * 1024 * 1024;

pub struct Db(Mutex<Connection>);

/// Append only. Index + 1 is the `user_version` after the migration runs.
const MIGRATIONS: &[&str] = &["
    CREATE TABLE kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE docs (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        json       TEXT NOT NULL,
        updated    INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
    );
"];

pub fn open(path: &Path) -> rusqlite::Result<Db> {
    let conn = Connection::open(path)?;
    // secure_delete overwrites deleted rows with zeros, so "deleted" means gone.
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;")?;
    migrate(&conn)?;
    Ok(Db(Mutex::new(conn)))
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        conn.execute_batch(&format!(
            "BEGIN; {sql} PRAGMA user_version = {}; COMMIT;",
            i + 1
        ))?;
    }
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn check_size(value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES {
        Err("value too large".into())
    } else {
        Ok(())
    }
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

#[tauri::command]
pub fn kv_get(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(err)?;
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [&key], |r| r.get(0))
        .optional()
        .map_err(err)
}

#[tauri::command]
pub fn kv_set(db: State<Db>, key: String, value: String) -> Result<(), String> {
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
pub fn docs_list(db: State<Db>, collection: String) -> Result<Vec<DocRow>, String> {
    let conn = db.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, json, updated FROM docs WHERE collection = ?1 ORDER BY updated DESC")
        .map_err(err)?;
    let rows = stmt
        .query_map([&collection], |r| {
            Ok(DocRow {
                id: r.get(0)?,
                json: r.get(1)?,
                updated: r.get(2)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[tauri::command]
pub fn doc_put(db: State<Db>, collection: String, id: String, json: String) -> Result<(), String> {
    check_size(&json)?;
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
pub fn doc_delete(db: State<Db>, collection: String, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute(
        "DELETE FROM docs WHERE collection = ?1 AND id = ?2",
        [&collection, &id],
    )
    .map_err(err)?;
    Ok(())
}
