import { AERIE_TABS } from "../../aerie/tabs";

/** Ids are plain strings so tabs can be added without editing a union type. */
export type ExpandedTab = string;

export interface TabMeta {
  id: ExpandedTab;
  label: string;
  /** Glyph for the glass theme. */
  icon: string;
  /** Material Symbols name for the Material theme (see aerie/theme/MaterialIcon.tsx). */
  symbol: string;
  ariaLabel: string;
  hasBadge?: boolean;
}

/** PILLAR's own tabs. Their content is rendered directly by Pill.tsx. */
export const BUILT_IN_TABS: TabMeta[] = [
  { id: "timer", label: "Timer", icon: "⏱", symbol: "timer", ariaLabel: "Timer module" },
  { id: "media", label: "Media", icon: "🎵", symbol: "music_note", ariaLabel: "Media controls" },
  { id: "notifications", label: "Notifs", icon: "🔔", symbol: "notifications", ariaLabel: "Notifications", hasBadge: true },
  { id: "settings", label: "Settings", icon: "⚙", symbol: "settings", ariaLabel: "Settings" },
  { id: "productivity", label: "Focus", icon: "✓", symbol: "task_alt", ariaLabel: "Productivity module" },
  { id: "prism", label: "Prism", icon: "AI", symbol: "star_shine", ariaLabel: "Prism AI assistant" },
];

/** Every tab in strip order: built-ins first, then Aerie's. */
export const EXPANDED_TAB_CONFIG: TabMeta[] = [
  ...BUILT_IN_TABS,
  ...AERIE_TABS.map(({ id, label, icon, symbol, ariaLabel }) => ({ id, label, icon, symbol, ariaLabel })),
];

export const ALL_TAB_IDS: ExpandedTab[] = EXPANDED_TAB_CONFIG.map((t) => t.id);

// Duplicate ids would make two tabs share one visibility toggle and one panel.
{
  const seen = new Set<string>();
  for (const id of ALL_TAB_IDS) {
    if (seen.has(id)) console.error(`[tabs] duplicate tab id "${id}"`);
    seen.add(id);
  }
}

/** A tab missing from the saved map (new tab, older settings file) is visible. */
export function isTabVisible(visibleTabs: Record<string, boolean>, id: ExpandedTab): boolean {
  return visibleTabs[id] !== false;
}
