import { useEffect, useState } from "react";
import { tauriInvoke } from "../../lib/tauri";

export interface HotkeyInfo {
  id: string;
  what: string;
  /** The combination in use, or null when every option was taken by other apps. */
  keys: string | null;
}

/** Defaults shown before the backend answers (and in the browser preview). */
const DEFAULTS: Record<string, string> = {
  visibility: "Ctrl+Alt+N",
  mic: "Ctrl+Alt+M",
  stack_collect: "Ctrl+Alt+C",
  stack_paste: "Ctrl+Alt+V",
  voice: "Ctrl+Alt+R",
  prompter: "Ctrl+Alt+P",
  prompter_faster: "Ctrl+Alt+Shift+↑",
  prompter_slower: "Ctrl+Alt+Shift+↓",
};

let cached: Promise<HotkeyInfo[]> | null = null;

/** Shortcuts as actually registered (Aerie falls back when another app owns one). */
export function useHotkeys(): { list: HotkeyInfo[]; label: (id: string) => string | null } {
  const [list, setList] = useState<HotkeyInfo[]>([]);
  useEffect(() => {
    cached ??= tauriInvoke<HotkeyInfo[]>("aerie_hotkeys", undefined, { silent: true })
      .then((r) => r ?? [])
      .catch(() => []);
    let alive = true;
    void cached.then((r) => alive && setList(r));
    return () => {
      alive = false;
    };
  }, []);
  const label = (id: string) => {
    const found = list.find((h) => h.id === id);
    return found ? found.keys : (DEFAULTS[id] ?? null);
  };
  return { list, label };
}
