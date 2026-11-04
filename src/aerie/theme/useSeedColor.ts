import { hexFromArgb, sourceColorFromImageBytes } from "@material/material-color-utilities";
import { useEffect, useState } from "react";
import { tauriInvoke } from "../../lib/tauri";
import { FALLBACK_SEED, parseHex } from "./palette";
import type { AerieSettingsData } from "../../hooks/useSettings";

interface WallpaperInfo {
  path: string;
  modified_ms: number;
  size: number;
}

/** Wallpaper and accent rarely change; a slow poll keeps idle CPU near zero. */
const POLL_MS = 30_000;
/** Downscale before quantizing: colour extraction needs shape of the palette, not detail. */
const SAMPLE_EDGE = 128;

/** Pixel-style seed: the most "theme-worthy" colour of an image (Material's Celebi + Score). */
async function seedFromImageUrl(url: string): Promise<string | null> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return hexFromArgb(sourceColorFromImageBytes(ctx.getImageData(0, 0, w, h).data));
}

/** Seed colour from the desktop wallpaper, re-read only when the file changes. */
function useWallpaperSeed(enabled: boolean): string | null {
  const [seed, setSeed] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let lastKey = "";

    const check = async () => {
      try {
        const info = await tauriInvoke<WallpaperInfo | null>("aerie_wallpaper_info", undefined, {
          silent: true,
        });
        const key = info ? `${info.path}|${info.modified_ms}|${info.size}` : "none";
        if (key === lastKey) return;
        lastKey = key;
        if (!info) {
          if (!disposed) setSeed(null); // solid-colour background
          return;
        }
        const url = await tauriInvoke<string | null>("aerie_wallpaper_image", undefined, {
          silent: true,
          timeoutMs: 30_000,
        });
        const next = url ? await seedFromImageUrl(url) : null;
        if (!disposed) setSeed(next);
      } catch {
        // Not in Tauri, or the image could not be read: keep the previous seed.
      }
    };

    void check();
    const id = window.setInterval(check, POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return seed;
}

/** The Windows accent colour (Settings > Personalization > Colors). */
function useWindowsAccent(enabled: boolean): string | null {
  const [accent, setAccent] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const check = async () => {
      try {
        const hex = await tauriInvoke<string | null>("aerie_windows_accent", undefined, { silent: true });
        if (!disposed) setAccent(hex);
      } catch {
        // Keep the previous value.
      }
    };
    void check();
    const id = window.setInterval(check, POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return accent;
}

/**
 * Resolve the Material seed for the chosen source, falling back
 * wallpaper -> Windows accent -> Material purple so there is always a colour.
 * `albumAccent` is the album-art colour while media plays, else null.
 */
export function useSeedColor(aerie: AerieSettingsData, albumAccent: string | null): string {
  const needsWallpaper = aerie.theme === "material" && (aerie.color_source === "wallpaper" || aerie.color_source === "album");
  const wallpaper = useWallpaperSeed(needsWallpaper);
  const windows = useWindowsAccent(aerie.theme === "material");

  const custom = parseHex(aerie.custom_seed) !== null ? aerie.custom_seed : null;
  const chain: Array<string | null> =
    aerie.color_source === "custom"
      ? [custom, wallpaper, windows]
      : aerie.color_source === "windows"
        ? [windows, wallpaper]
        : aerie.color_source === "album"
          ? [albumAccent, wallpaper, windows]
          : [wallpaper, windows];
  return chain.find((c): c is string => !!c) ?? FALLBACK_SEED;
}
