import type { ComponentType } from "react";
import type { AppSettings, DeepPartial } from "../../hooks/useSettings";

/** Props every Aerie tab receives from the pill. */
export interface AerieTabProps {
  /** Current accent colour (album art or user choice), as a CSS colour. */
  accentColor: string;
  /** All saved settings. Aerie's own live under `settings.aerie`. */
  settings: AppSettings;
  /** Merge a patch into saved settings and persist it. Rejects if saving fails. */
  updateSettings: (patch: DeepPartial<AppSettings>) => Promise<void>;
}

/**
 * One tab in the expanded pill. To add a tool: create its component under
 * `src/aerie/tabs/`, then add one entry to `AERIE_TABS` in `./index.ts`.
 * The tab then appears in the strip, in keyboard navigation, in screen-reader
 * announcements and in the Layout toggles in Settings, with no other edits.
 */
export interface AerieTab {
  /** Unique, stable id. Also the key in `layout.visible_tabs`. Must not reuse a built-in id. */
  id: string;
  /** Short text shown on the tab. */
  label: string;
  /** Single glyph shown before the label in the glass theme. */
  icon: string;
  /** Material Symbols name shown in the Material theme (must be bundled in MaterialIcon.tsx). */
  symbol: string;
  /** Full name for screen readers. */
  ariaLabel: string;
  Component: ComponentType<AerieTabProps>;
}
