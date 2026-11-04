import { invoke } from "@tauri-apps/api/core";
import type { Edge, IdleLook, OpenOn, PanelSize } from "../settings";
import type { TabProps } from "./index";

const SIZES: { id: PanelSize; label: string }[] = [
  { id: "s", label: "Small" },
  { id: "m", label: "Medium" },
  { id: "l", label: "Large" },
];

const EDGES: { id: Edge; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];

const OPEN_ON: { id: OpenOn; label: string }[] = [
  { id: "click", label: "Click" },
  { id: "hover", label: "Hover" },
];

const IDLE: { id: IdleLook; label: string }[] = [
  { id: "pill", label: "Pill" },
  { id: "slim", label: "Slim line" },
];

export function SettingsTab({ settings, updateSettings, monitorCount }: TabProps) {
  const monitor = settings.monitor % Math.max(monitorCount, 1);
  return (
    <div className="settings">
      <div className="row">
        <span>Open on</span>
        <div className="seg">
          {OPEN_ON.map((o) => (
            <button
              key={o.id}
              className={settings.openOn === o.id ? "on" : ""}
              onClick={() => updateSettings({ openOn: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span>When idle</span>
        <div className="seg">
          {IDLE.map((o) => (
            <button
              key={o.id}
              className={settings.idle === o.id ? "on" : ""}
              onClick={() => updateSettings({ idle: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span className="muted">Hide or show: Ctrl+Alt+N or tray icon</span>
        <button className="btn" onClick={() => invoke("toggle_notch")}>
          Hide now
        </button>
      </div>
      <div className="row">
        <span>Panel size</span>
        <div className="seg">
          {SIZES.map((s) => (
            <button
              key={s.id}
              className={settings.size === s.id ? "on" : ""}
              onClick={() => updateSettings({ size: s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span>Screen edge</span>
        <div className="seg">
          {EDGES.map((e) => (
            <button
              key={e.id}
              className={settings.edge === e.id ? "on" : ""}
              onClick={() => updateSettings({ edge: e.id })}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span>
          Monitor {monitor + 1} of {monitorCount}
        </span>
        <button
          className="btn"
          disabled={monitorCount < 2}
          onClick={() => updateSettings({ monitor: (monitor + 1) % monitorCount })}
        >
          Move to next
        </button>
      </div>
      <div className="row">
        <span className="muted">Also quit from the tray icon.</span>
        <button className="btn danger" onClick={() => invoke("quit_app")}>
          Quit
        </button>
      </div>
    </div>
  );
}
