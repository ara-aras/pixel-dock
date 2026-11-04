import { tauriInvoke } from "../../lib/tauri";

// Client for Aerie's SQLite store (src-tauri/src/aerie_db.rs).
// Outside Tauri (plain browser preview) invoke returns null, so reads come back empty.

export async function kvGet(key: string): Promise<string | null> {
  return (await tauriInvoke<string | null>("aerie_kv_get", { key })) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await tauriInvoke("aerie_kv_set", { key, value });
}

/** JSON helpers on top of kv, tolerant of missing or corrupt values. */
export async function kvGetJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await kvGet(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export const kvSetJson = (key: string, value: unknown) => kvSet(key, JSON.stringify(value));

export interface Doc<T> {
  id: string;
  updated: number;
  data: T;
}

/** Newest first. Rows whose JSON fails to parse are skipped instead of breaking the list. */
export async function docsList<T>(collection: string): Promise<Doc<T>[]> {
  const rows = (await tauriInvoke<Array<{ id: string; json: string; updated: number }>>("aerie_docs_list", { collection })) ?? [];
  return rows.flatMap((r) => {
    try {
      return [{ id: r.id, updated: r.updated, data: JSON.parse(r.json) as T }];
    } catch {
      return [];
    }
  });
}

export async function docPut<T>(collection: string, id: string, data: T): Promise<void> {
  await tauriInvoke("aerie_doc_put", { collection, id, json: JSON.stringify(data) });
}

export async function docDelete(collection: string, id: string): Promise<void> {
  await tauriInvoke("aerie_doc_delete", { collection, id });
}

export const newId = () => crypto.randomUUID();

/** Clipboard helpers (Rust side, so they work without webview clipboard permissions). */
export async function writeClipboardText(text: string): Promise<void> {
  await tauriInvoke("aerie_clipboard_write_text", { text });
}

export async function readClipboardText(): Promise<string> {
  return (await tauriInvoke<string | null>("aerie_clipboard_read_text")) ?? "";
}
