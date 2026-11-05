import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import type { AerieSettingsData } from "../../hooks/useSettings";
import { useHotkeys } from "../hooks/useHotkeys";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+Alt+N", "Hide or show the whole overlay"],
  ["Alt+Shift+Space", "Open or close the panel"],
  ["Alt+Shift+P", "Open Focus (tasks, notes)"],
  ["Alt+Shift+A", "Open Prism AI"],
];

/** Colour roles shown in the preview strip, as Pixel's Settings > Wallpaper & style does. */
const SWATCHES: Array<[string, string]> = [
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["tertiary", "Tertiary"],
  ["primary-container", "Primary container"],
  ["secondary-container", "Secondary container"],
  ["surface-container-highest", "Surface"],
];

function Choice<T extends string | boolean>({
  label,
  hint,
  value,
  options,
  onPick,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; text: string }>;
  onPick: (v: T) => void;
}) {
  const { isMaterial } = useAerieThemeContext();
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-white">{label}</span>
        <div
          className={`flex gap-0.5 ${isMaterial ? "rounded-full bg-surface-container-high p-0.5" : ""}`}
          role="radiogroup"
          aria-label={label}
        >
          {options.map((o) => {
            const on = o.value === value;
            const look = isMaterial
              ? on
                ? "rounded-full bg-secondary-container text-on-secondary-container"
                : "rounded-full text-on-surface-variant hover:bg-on-surface/[0.08]"
              : on
                ? "rounded bg-white/20 text-white"
                : "rounded bg-white/8 text-white/60 hover:text-white hover:bg-white/12";
            return (
              <button
                key={String(o.value)}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(o.value)}
                className={`text-[10px] px-2 py-0.5 transition-colors ${look}`}
              >
                {o.text}
              </button>
            );
          })}
        </div>
      </div>
      {hint && <span className="text-[10px] text-white/50">{hint}</span>}
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  const { isMaterial } = useAerieThemeContext();
  return (
    <section
      className={`flex flex-col gap-2 p-2 ${isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/5"}`}
    >
      <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: accent }}>
        {title}
      </span>
      {children}
    </section>
  );
}

/** Aerie's own options. Stored in `settings.aerie`, which Rust keeps as free-form JSON. */
export function AerieSettingsTab({ accentColor, settings, updateSettings }: AerieTabProps) {
  const aerie = settings.aerie;
  const material = aerie.theme === "material";
  const hotkeys = useHotkeys().list;
  // Live list (what actually registered); the static one only before it loads.
  const shortcutRows: ReadonlyArray<readonly [string | null, string]> = hotkeys.length
    ? hotkeys.map((h) => [h.keys, h.what] as const)
    : SHORTCUTS;
  const set = (patch: Partial<AerieSettingsData>) =>
    fireAndForget(updateSettings({ aerie: patch }), "aerie settings change");

  return (
    <div className="flex flex-col gap-2 p-1">
      <Section title="Look" accent={accentColor}>
        <Choice
          label="Theme"
          value={aerie.theme}
          options={[
            { value: "material", text: "Material" },
            { value: "glass", text: "Glass" },
          ]}
          onPick={(theme) => set({ theme })}
          hint={material ? "Pixel-style Material 3 colours, shapes and motion." : "PILLAR's original dark glass."}
        />
        {material && (
          <>
            <Choice
              label="Colours from"
              value={aerie.color_source}
              options={[
                { value: "wallpaper", text: "Wallpaper" },
                { value: "album", text: "Album" },
                { value: "windows", text: "Windows" },
                { value: "custom", text: "Custom" },
              ]}
              onPick={(color_source) => set({ color_source })}
              hint={
                aerie.color_source === "album"
                  ? "Album art while music plays, wallpaper otherwise."
                  : aerie.color_source === "windows"
                    ? "The Windows accent colour (Settings > Personalization > Colors)."
                    : aerie.color_source === "custom"
                      ? "Pick any seed colour."
                      : "Like Pixel: colours picked from your desktop wallpaper."
              }
            />
            {aerie.color_source === "custom" && (
              <label className="flex items-center justify-between gap-2 text-[12px] text-white">
                Seed colour
                <input
                  type="color"
                  value={aerie.custom_seed}
                  onChange={(e) => set({ custom_seed: e.target.value })}
                  aria-label="Seed colour"
                  className="h-7 w-12 cursor-pointer rounded-full border-0 bg-transparent p-0"
                />
              </label>
            )}
            <Choice
              label="Mode"
              value={aerie.color_mode}
              options={[
                { value: "system", text: "System" },
                { value: "light", text: "Light" },
                { value: "dark", text: "Dark" },
              ]}
              onPick={(color_mode) => set({ color_mode })}
            />
            <Choice
              label="Style"
              value={aerie.scheme_style}
              options={[
                { value: "tonal", text: "Tonal" },
                { value: "vibrant", text: "Vibrant" },
                { value: "expressive", text: "Expressive" },
              ]}
              onPick={(scheme_style) => set({ scheme_style })}
            />
            <div className="flex gap-1" aria-label="Palette preview">
              {SWATCHES.map(([role, name]) => (
                <span
                  key={role}
                  title={name}
                  className="h-6 flex-1 rounded-full border border-outline-variant/40"
                  style={{ background: `rgb(var(--md-${role}))` }}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Stay out of the way" accent={accentColor}>
        <Choice
          label="Open on hover"
          hint="Off: the pill ignores hover and only a click opens it."
          value={aerie.hover_peek}
          options={[
            { value: true, text: "On" },
            { value: false, text: "Off" },
          ]}
          onPick={(hover_peek) => set({ hover_peek })}
        />
        <Choice
          label="Idle look"
          hint="Slim line is a thin strip that barely covers anything."
          value={aerie.idle_style}
          options={[
            { value: "pill", text: "Pill" },
            { value: "slim", text: "Slim line" },
          ]}
          onPick={(idle_style) => set({ idle_style })}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-white/50">Bring it back with Ctrl+Alt+N or the tray menu.</span>
          <button
            type="button"
            onClick={() => fireAndForget(tauriInvoke("aerie_toggle_visibility"), "hide overlay")}
            className={`shrink-0 px-3 py-1 text-[11px] font-medium ${
              material ? "rounded-full bg-primary text-on-primary" : "rounded bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            Hide now
          </button>
        </div>
      </Section>

      <Section title="Shortcuts" accent={accentColor}>
        {shortcutRows.map(([keys, what]) => (
          <div key={what} className="flex justify-between gap-2 text-[11px]">
            <kbd className={`font-mono ${keys ? "text-white/85" : "text-red-400"}`}>{keys ?? "taken by another app"}</kbd>
            <span className="text-white/60 text-right">{what}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
