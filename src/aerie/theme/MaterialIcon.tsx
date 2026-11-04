// Material Symbols (Apache-2.0), bundled locally as SVG text: the CSP allows no
// remote fonts, and an inline SVG inherits `currentColor`.
// To add an icon, add its name to scripts/gen-icons.mts and run it.
import { ICONS } from "./icons.generated";

export type MaterialIconName = keyof typeof ICONS;

export function isMaterialIconName(name: string): name is MaterialIconName {
  return name in ICONS;
}

/** Pixel style: outlined when inactive, filled when selected. Decorative (aria-hidden). */
export function MaterialIcon({
  name,
  filled = false,
  size = 18,
  className = "",
}: {
  name: MaterialIconName;
  filled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-current ${className}`}
      style={{ width: size, height: size }}
      // Trusted, build-time SVG from the icon package; never user content.
      dangerouslySetInnerHTML={{ __html: ICONS[name][filled ? 1 : 0] }}
    />
  );
}
