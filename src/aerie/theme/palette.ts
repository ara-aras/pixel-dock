import {
  argbFromHex,
  type DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeExpressive,
  SchemeTonalSpot,
  SchemeVibrant,
} from "@material/material-color-utilities";

// Pure palette logic (no React, DOM or Tauri), so it can be tested in Node.

/** Material 3 colour roles exposed to CSS as `--md-<role>` (space-separated RGB). */
export const ROLES = [
  "surface",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "on-surface",
  "on-surface-variant",
  "outline",
  "outline-variant",
  "inverse-surface",
  "inverse-on-surface",
  "inverse-primary",
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
  "scrim",
  "shadow",
] as const;

export type Role = (typeof ROLES)[number];
/** Role -> ARGB integer. */
export type Palette = Record<Role, number>;

/** Pixel's default is Tonal Spot; Vibrant and Expressive are its bolder styles. */
export type SchemeStyle = "tonal" | "vibrant" | "expressive";

/** Material 3's default purple, used when no seed colour is available. */
export const FALLBACK_SEED = "#6750A4";

const camel = (role: string) => role.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function scheme(seed: number, dark: boolean, style: SchemeStyle, contrast: number): DynamicScheme {
  const hct = Hct.fromInt(seed);
  // "2025" is the Material 3 Expressive colour spec used on current Pixels.
  switch (style) {
    case "vibrant":
      return new SchemeVibrant(hct, dark, contrast, "2025");
    case "expressive":
      return new SchemeExpressive(hct, dark, contrast, "2025");
    default:
      return new SchemeTonalSpot(hct, dark, contrast, "2025");
  }
}

/** Full Material palette from one seed colour. `contrast` is -1..1 (0 = standard). */
export function materialPalette(
  seedHex: string,
  dark: boolean,
  style: SchemeStyle = "tonal",
  contrast = 0,
): Palette {
  const seed = parseHex(seedHex) ?? argbFromHex(FALLBACK_SEED);
  const s = scheme(seed, dark, style, contrast);
  const colors = new MaterialDynamicColors() as unknown as Record<
    string,
    () => { getArgb: (s: DynamicScheme) => number }
  >;
  const out = {} as Palette;
  for (const role of ROLES) out[role] = colors[camel(role)]().getArgb(s);
  return out;
}

/**
 * PILLAR's original dark glass look expressed as the same roles. Surfaces and text
 * keep PILLAR's neutral greys and pure white (so `text-white/85` and friends look
 * exactly as before); accents come from the accent colour's dark Material palette.
 */
export function glassPalette(accentHex: string): Palette {
  const accent = materialPalette(accentHex, true, "tonal");
  const rgb = (r: number, g: number, b: number) => (0xff << 24) | (r << 16) | (g << 8) | b;
  const accentArgb = parseHex(accentHex) ?? accent.primary;
  return {
    ...accent,
    surface: rgb(20, 20, 22),
    "surface-dim": rgb(15, 15, 18),
    "surface-bright": rgb(44, 44, 50),
    "surface-container-lowest": rgb(15, 15, 18),
    "surface-container-low": rgb(24, 24, 27),
    "surface-container": rgb(30, 30, 35),
    "surface-container-high": rgb(38, 38, 43),
    "surface-container-highest": rgb(46, 46, 52),
    "on-surface": rgb(255, 255, 255),
    "on-surface-variant": rgb(200, 200, 206),
    outline: rgb(140, 140, 148),
    "outline-variant": rgb(64, 64, 70),
    primary: accentArgb,
    "on-primary": rgb(255, 255, 255),
    scrim: rgb(0, 0, 0),
    shadow: rgb(0, 0, 0),
  };
}

/** "#rrggbb" / "#rgb" -> ARGB, or null if not a hex colour. */
export function parseHex(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return argbFromHex(`#${h}`);
}

export const toHex = (argb: number) => hexFromArgb(argb);

/** ARGB -> "r g b", the form Tailwind needs for `rgb(var(--x) / <alpha-value>)`. */
export function toTriplet(argb: number): string {
  return `${(argb >> 16) & 0xff} ${(argb >> 8) & 0xff} ${argb & 0xff}`;
}

/** CSS custom properties for a palette: `--md-primary: "103 80 164"`, ... */
export function cssVariables(palette: Palette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const role of ROLES) vars[`--md-${role}`] = toTriplet(palette[role]);
  return vars;
}

/** WCAG contrast ratio between two ARGB colours (1..21). */
export function contrastRatio(a: number, b: number): number {
  const lum = (argb: number) => {
    const ch = [(argb >> 16) & 0xff, (argb >> 8) & 0xff, argb & 0xff].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
