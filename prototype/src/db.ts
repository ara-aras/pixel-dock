import { invoke } from "@tauri-apps/api/core";

export const kvGet = (key: string) => invoke<string | null>("kv_get", { key });
export const kvSet = (key: string, value: string) => invoke<void>("kv_set", { key, value });

export interface Doc<T> {
  id: string;
  updated: number;
  data: T;
}

interface RawDoc {
  id: string;
  json: string;
  updated: number;
}

/** Newest first. Rows with unparseable JSON are skipped rather than breaking the list. */
export async function docsList<T>(collection: string): Promise<Doc<T>[]> {
  const rows = await invoke<RawDoc[]>("docs_list", { collection });
  return rows.flatMap((r) => {
    try {
      return [{ id: r.id, updated: r.updated, data: JSON.parse(r.json) as T }];
    } catch {
      return [];
    }
  });
}

export const docPut = <T>(collection: string, id: string, data: T) =>
  invoke<void>("doc_put", { collection, id, json: JSON.stringify(data) });

export const docDelete = (collection: string, id: string) =>
  invoke<void>("doc_delete", { collection, id });

export const newId = () => crypto.randomUUID();
