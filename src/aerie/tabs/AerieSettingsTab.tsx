import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import type { AerieSettingsData } from "../../hooks/useSettings";
import type { AerieTabProps } from "./types";

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+Alt+N", "Hide or show the whole overlay"],
  ["Alt+Shift+Space", "Open or close the panel"],
  ["Alt+Shift+P", "Open Focus (tasks, notes)"],
  ["Alt+Shift+A", "Open Prism AI"],
];

function Choice<T extends string | boolean>({
  label,
  hint,
  value,
  options,
  onPick,
}: {
  label: string;
  hint: string;
  value: T;
  options: Array<{ value: T; text: string }>;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-white">{label}</span>
        <div className="flex gap-1" role="radiogroup" aria-label={label}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={o.value === value}
              onClick={() => onPick(o.value)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                o.value === value
                  ? "bg-white/20 text-white"
                  : "bg-white/8 text-white/60 hover:text-white hover:bg-white/12"
              }`}
            >
              {o.text}
            </button>
          ))}
        </div>
      </div>
      <span className="text-[10px] text-white/50">{hint}</span>
    </div>
  );
}

/** Aerie's own options. Stored in `settings.aerie`, which Rust keeps as free-form JSON. */
export function AerieSettingsTab({ accentColor, settings, updateSettings }: AerieTabProps) {
  const aerie = settings.aerie;
  const set = (patch: Partial<AerieSettingsData>) =>
    fireAndForget(updateSettings({ aerie: patch }), "aerie settings change");

  return (
    <div className="flex flex-col gap-2 p-1">
      <span className="text-[11px] uppercase tracking-wider" style={{ color: accentColor }}>
        Stay out of the way
      </span>

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

      <button
        type="button"
        onClick={() => fireAndForget(tauriInvoke("aerie_toggle_visibility"), "hide overlay")}
        className="self-start rounded bg-white/10 px-2 py-1 text-[11px] text-white hover:bg-white/15"
      >
        Hide now
      </button>
      <span className="text-[10px] text-white/50">
        Bring it back with Ctrl+Alt+N or the tray icon menu.
      </span>

      <div className="mt-1 flex flex-col gap-0.5 rounded-lg bg-white/5 p-2">
        <span className="text-[11px] uppercase tracking-wider text-white/85">Shortcuts</span>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex justify-between gap-2 text-[11px]">
            <kbd className="font-mono text-white/85">{keys}</kbd>
            <span className="text-white/60">{what}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
