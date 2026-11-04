import { useCallback, useState } from "react";

export type Edge = "top" | "bottom";
export type PanelSize = "s" | "m" | "l";

export type OpenOn = "click" | "hover";
export type IdleLook = "pill" | "slim";

export interface Settings {
  edge: Edge;
  size: PanelSize;
  /** Index into the OS monitor list; wraps around if a monitor is unplugged. */
  monitor: number;
  /** Click is the safe default: hover can open the panel while aiming at another app. */
  openOn: OpenOn;
  /** Slim shrinks the idle pill to a thin strip so it barely covers anything. */
  idle: IdleLook;
}

export const DEFAULT_SETTINGS: Settings = {
  edge: "top",
  size: "m",
  monitor: 0,
  openOn: "click",
  idle: "pill",
};

const KEY = "aerie.settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return DEFAULT_SETTINGS;
}

function save(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: settings just won't persist.
  }
}

// UI preferences only. User data (notes, clips, ...) goes to SQLite from Phase 2.
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);
  return [settings, update] as const;
}
