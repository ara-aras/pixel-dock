import type { PillThemeTokens } from "../../components/Pill/themeTokens";

/**
 * Material counterpart of PILLAR's createPillThemeTokens(). Values are CSS strings
 * that read the live `--md-*` palette, so they follow wallpaper and light/dark
 * changes without recomputing. `opacity` is PILLAR's appearance slider (0-100).
 */
export function createMaterialPillTokens(opacity: number, accentHex: string): PillThemeTokens {
  const alpha = Math.min(1, Math.max(0.5, opacity / 100));
  return {
    surfacePrimary: `rgb(var(--md-surface-container) / ${alpha})`,
    surfaceSecondary: `rgb(var(--md-surface-container) / ${alpha})`,
    borderColor: "rgb(var(--md-outline-variant) / 0.5)",
    textPrimary: "rgb(var(--md-on-surface))",
    textMuted: "rgb(var(--md-on-surface-variant))",
    accent: accentHex,
    accentSoft: "rgb(var(--md-primary) / 0.25)",
    shadow: "0 4px 16px rgb(var(--md-shadow) / 0.22)",
  };
}
