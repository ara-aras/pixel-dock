// Material Symbols (Apache-2.0), Rounded, weight 400. Bundled locally as SVG text:
// the CSP allows no remote fonts, and an inline SVG inherits `currentColor`.
import starShine from "@material-symbols/svg-400/rounded/star_shine.svg?raw";
import calculate from "@material-symbols/svg-400/rounded/calculate.svg?raw";
import musicNote from "@material-symbols/svg-400/rounded/music_note.svg?raw";
import notifications from "@material-symbols/svg-400/rounded/notifications.svg?raw";
import palette from "@material-symbols/svg-400/rounded/palette.svg?raw";
import settings from "@material-symbols/svg-400/rounded/settings.svg?raw";
import swapHoriz from "@material-symbols/svg-400/rounded/swap_horiz.svg?raw";
import taskAlt from "@material-symbols/svg-400/rounded/task_alt.svg?raw";
import timer from "@material-symbols/svg-400/rounded/timer.svg?raw";
import starShineFill from "@material-symbols/svg-400/rounded/star_shine-fill.svg?raw";
import calculateFill from "@material-symbols/svg-400/rounded/calculate-fill.svg?raw";
import musicNoteFill from "@material-symbols/svg-400/rounded/music_note-fill.svg?raw";
import notificationsFill from "@material-symbols/svg-400/rounded/notifications-fill.svg?raw";
import paletteFill from "@material-symbols/svg-400/rounded/palette-fill.svg?raw";
import settingsFill from "@material-symbols/svg-400/rounded/settings-fill.svg?raw";
import swapHorizFill from "@material-symbols/svg-400/rounded/swap_horiz-fill.svg?raw";
import taskAltFill from "@material-symbols/svg-400/rounded/task_alt-fill.svg?raw";
import timerFill from "@material-symbols/svg-400/rounded/timer-fill.svg?raw";

const ICONS = {
  star_shine: [starShine, starShineFill],
  calculate: [calculate, calculateFill],
  music_note: [musicNote, musicNoteFill],
  notifications: [notifications, notificationsFill],
  palette: [palette, paletteFill],
  settings: [settings, settingsFill],
  swap_horiz: [swapHoriz, swapHorizFill],
  task_alt: [taskAlt, taskAltFill],
  timer: [timer, timerFill],
} as const;

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
