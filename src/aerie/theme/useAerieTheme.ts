import { useEffect, useMemo, useState } from "react";
import type { AerieSettingsData } from "../../hooks/useSettings";
import { cssVariables, glassPalette, materialPalette, type Palette, toHex } from "./palette";
import { useSeedColor } from "./useSeedColor";

export interface AerieTheme {
  isMaterial: boolean;
  isDark: boolean;
  palette: Palette;
  /** Seed the palette was built from (material) or the glass accent. */
  seed: string;
  /** Colour modules should use as "the accent" (primary in material). */
  accentHex: string;
}

function useSystemDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setDark(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/**
 * Computes the active palette and applies it to <html>:
 * - `data-theme="material" | "glass"` and `data-mode="dark" | "light"`
 * - `--md-<role>` RGB triplets used by Tailwind colours (`white` maps to on-surface)
 */
export function useAerieTheme(
  aerie: AerieSettingsData,
  glassAccent: string,
  albumAccent: string | null,
): AerieTheme {
  const systemDark = useSystemDark();
  const seed = useSeedColor(aerie, albumAccent);
  const isMaterial = aerie.theme === "material";
  const isDark = !isMaterial || (aerie.color_mode === "system" ? systemDark : aerie.color_mode === "dark");

  const palette = useMemo(
    () => (isMaterial ? materialPalette(seed, isDark, aerie.scheme_style) : glassPalette(glassAccent)),
    [isMaterial, seed, isDark, aerie.scheme_style, glassAccent],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = isMaterial ? "material" : "glass";
    root.dataset.mode = isDark ? "dark" : "light";
    root.style.colorScheme = isDark ? "dark" : "light";
    for (const [name, value] of Object.entries(cssVariables(palette))) {
      root.style.setProperty(name, value);
    }
    // PILLAR's own --pillar-* variables are written by Pill.tsx from its theme tokens,
    // which are Material-aware (see pillTokens.ts), so they are not touched here.
  }, [palette, isMaterial, isDark]);

  return {
    isMaterial,
    isDark,
    palette,
    seed: isMaterial ? seed : glassAccent,
    accentHex: isMaterial ? toHex(palette.primary) : glassAccent,
  };
}
