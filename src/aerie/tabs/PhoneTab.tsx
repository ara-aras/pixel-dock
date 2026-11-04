import { useCallback, useEffect, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import { useAerieEvent } from "../hooks/useAerieEvent";
import { kvGetJson } from "../lib/store";
import { relativeTime } from "../lib/time";
import { MaterialIcon } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

interface PhoneNotification {
  id: string;
  app: string;
  title: string;
  text: string;
  time: number;
}

interface Device {
  id: string;
  name: string;
  paired: boolean;
  connected: boolean;
  battery: number | null;
  charging: boolean;
  incoming_pair: boolean;
  pending_pair: boolean;
  fingerprint: string | null;
  notifications: PhoneNotification[];
}

interface PhoneState {
  enabled: boolean;
  status: string;
  name: string;
  fingerprint: string | null;
  ip: string | null;
  clipboard_sync: boolean;
  toasts: boolean;
  devices: Device[];
}

const EMPTY: PhoneState = {
  enabled: false,
  status: "Off",
  name: "",
  fingerprint: null,
  ip: null,
  clipboard_sync: true,
  toasts: true,
  devices: [],
};

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  const { isMaterial } = useAerieThemeContext();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? (isMaterial ? "bg-primary" : "bg-pill-accent") : "bg-white/20"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${on ? `left-[18px] ${isMaterial ? "bg-on-primary" : "bg-fixed-white"}` : "left-0.5 bg-white/70"}`} />
    </button>
  );
}

/** Phone link (KDE Connect protocol): pair your Android phone, see its notifications, sync clipboard, send files. */
export function PhoneTab({ accentColor }: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const [state, setState] = useState<PhoneState>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    void tauriInvoke<PhoneState>("aerie_phone_state", undefined, { silent: true })
      .then((s) => s && setState(s))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useAerieEvent("aerie://phone", load);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 2000);
  };
  const run = (cmd: string, args: Record<string, unknown>, ok?: string) =>
    fireAndForget(
      tauriInvoke(cmd, args).then(() => (ok ? flash(ok) : undefined)).catch((e) => flash(String(e).slice(0, 80))),
      cmd,
    );

  const card = isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/8";
  const primaryBtn = isMaterial ? "rounded-full bg-primary text-on-primary" : "rounded bg-white/20 text-white";
  const tonalBtn = isMaterial ? "rounded-full bg-secondary-container text-on-secondary-container" : "rounded bg-white/12 text-white";

  const device = state.devices.find((d) => d.id === selected) ?? state.devices.find((d) => d.paired && d.connected) ?? state.devices[0];

  if (!state.enabled) {
    return (
      <div className="flex flex-col items-center gap-2 p-3 text-center">
        <span className={`flex h-12 w-12 items-center justify-center ${isMaterial ? "rounded-2xl bg-primary-container text-on-primary-container" : "rounded-xl bg-white/10 text-white"}`}>
          <MaterialIcon name="devices" size={26} filled />
        </span>
        <span className="text-[13px] font-medium text-white">Link your Android phone</span>
        <span className="max-w-[320px] text-[11px] text-white/60">
          Install the free <b>KDE Connect</b> app on your phone, keep both on the same Wi-Fi, then turn this on. Windows may ask to
          allow Aerie through the firewall: allow it on private networks.
        </span>
        <button type="button" onClick={() => run("aerie_phone_set_enabled", { enabled: true })} className={`px-4 py-1.5 text-[12px] font-medium ${primaryBtn}`}>
          Turn on phone link
        </button>
        <span className="text-[10px] text-white/40">Nothing leaves your network. Phones must be paired before they can send anything.</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 gap-2 p-1">
      {/* Side card: this PC, status, devices */}
      <div className={`flex w-[150px] shrink-0 flex-col gap-1.5 p-2 ${card}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-white">Phone link</span>
          <Switch on={state.enabled} label="Phone link" onChange={(v) => run("aerie_phone_set_enabled", { enabled: v })} />
        </div>
        <span className="text-[10px] text-white/55" aria-live="polite">{state.status}</span>
        <div className="mt-1 flex flex-col gap-1">
          {state.devices.length === 0 && (
            <span className="text-[10px] text-white/50">
              Open KDE Connect on the phone. Not showing up? Add this PC by IP: <b className="text-white/80">{state.ip ?? "?"}</b>
            </span>
          )}
          {state.devices.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelected(d.id)}
              className={`flex items-center gap-1.5 px-1.5 py-1 text-left text-[11px] ${
                d.id === device?.id ? (isMaterial ? "rounded-xl bg-secondary-container text-on-secondary-container" : "rounded bg-white/15 text-white") : "rounded-xl text-white/80 hover:bg-white/8"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${d.connected ? "bg-green-500" : "bg-white/25"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{d.name || "Phone"}</span>
              {d.battery !== null && <span className="text-[10px] opacity-70">{d.battery}%</span>}
            </button>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-1.5">
          <label className="flex items-center justify-between gap-1 text-[10px] text-white/75">
            Sync clipboard
            <Switch on={state.clipboard_sync} label="Sync clipboard" onChange={(v) => run("aerie_phone_set_option", { option: "clipboard_sync", on: v })} />
          </label>
          <label className="flex items-center justify-between gap-1 text-[10px] text-white/75">
            Show notifications
            <Switch on={state.toasts} label="Show phone notifications on this PC" onChange={(v) => run("aerie_phone_set_option", { option: "toasts", on: v })} />
          </label>
          <span className="text-[9px] text-white/40" title="Compare with the code KDE Connect shows when pairing">
            This PC: {state.fingerprint ?? "…"}
          </span>
        </div>
      </div>

      {/* Main: selected device */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {!device ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-[11px] text-white/55">
            <MaterialIcon name="devices" size={28} className="text-white/40" />
            Waiting for a phone running KDE Connect on this network.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{device.name}</span>
              {device.battery !== null && (
                <span className="flex items-center gap-0.5 text-[11px] text-white/70">
                  <MaterialIcon name={device.charging ? "battery_charging_full" : "battery_full"} size={14} />
                  {device.battery}%
                </span>
              )}
              {device.paired && device.connected && (
                <>
                  <button type="button" title="Ring my phone" aria-label="Ring my phone" onClick={() => run("aerie_phone_ring", { id: device.id }, "Ringing…")} className="rounded-full p-1 text-white/75 hover:bg-white/10">
                    <MaterialIcon name="ring_volume" size={16} />
                  </button>
                  <button
                    type="button"
                    title="Send files from the Shelf"
                    aria-label="Send Shelf files to phone"
                    onClick={async () => {
                      const shelf = await kvGetJson<Array<{ path: string }>>("shelf.items", []);
                      if (shelf.length === 0) return flash("Shelf is empty: drop files there first");
                      run("aerie_phone_send_files", { id: device.id, paths: shelf.map((s) => s.path) }, `Sent ${shelf.length} file(s)`);
                    }}
                    className="rounded-full p-1 text-white/75 hover:bg-white/10"
                  >
                    <MaterialIcon name="send" size={16} />
                  </button>
                </>
              )}
              {device.paired && (
                <button type="button" title="Unpair" aria-label="Unpair" onClick={() => run("aerie_phone_unpair", { id: device.id }, "Unpaired")} className="rounded-full p-1 text-white/55 hover:bg-white/10 hover:text-red-400">
                  <MaterialIcon name="link_off" size={16} />
                </button>
              )}
            </div>

            {device.incoming_pair && (
              <div className={`flex flex-col gap-1 p-2 ${card}`} role="alert">
                <span className="text-[12px] text-white">{device.name} wants to pair</span>
                <span className="text-[10px] text-white/60">Check this code matches the one on your phone: {device.fingerprint}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => run("aerie_phone_answer_pair", { id: device.id, accept: true }, "Paired")} className={`px-3 py-0.5 text-[11px] font-medium ${primaryBtn}`}>
                    Accept
                  </button>
                  <button type="button" onClick={() => run("aerie_phone_answer_pair", { id: device.id, accept: false })} className="px-2 text-[11px] text-white/70 hover:text-white">
                    Decline
                  </button>
                </div>
              </div>
            )}

            {!device.paired && !device.incoming_pair && (
              <div className={`flex flex-col items-start gap-1 p-2 ${card}`}>
                <span className="text-[11px] text-white/75">
                  {device.connected ? "Found on your network. Pair to share notifications, clipboard and files." : "Paired before but not reachable right now."}
                </span>
                {device.connected && (
                  <button type="button" disabled={device.pending_pair} onClick={() => run("aerie_phone_pair", { id: device.id }, "Accept on your phone")} className={`px-3 py-0.5 text-[11px] font-medium disabled:opacity-50 ${primaryBtn}`}>
                    {device.pending_pair ? "Waiting for phone…" : "Pair"}
                  </button>
                )}
              </div>
            )}

            {device.paired && (
              <>
                <h4 className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-white/50">
                  Notifications
                  <span className={`px-1.5 text-[9px] ${tonalBtn}`}>{device.notifications.length}</span>
                </h4>
                <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto" aria-label={`Notifications from ${device.name}`}>
                  {device.notifications.length === 0 && (
                    <li className="py-2 text-center text-[10px] text-white/50">
                      {device.connected ? "None yet. In KDE Connect, enable Notification sync and grant it notification access." : "Phone is offline."}
                    </li>
                  )}
                  {device.notifications.map((n) => (
                    <li key={n.id} className={`group flex items-start gap-2 px-2 py-1 ${card}`}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[11px] text-white">
                          <b>{n.app}</b>
                          {n.title ? ` · ${n.title}` : ""}
                        </span>
                        {n.text && <span className="line-clamp-2 text-[10px] text-white/65">{n.text}</span>}
                      </span>
                      <span className="text-[9px] text-white/40">{relativeTime(n.time)}</span>
                      <button
                        type="button"
                        aria-label="Dismiss on phone"
                        onClick={() => run("aerie_phone_dismiss", { id: device.id, notificationId: n.id })}
                        className="rounded-full p-0.5 text-white/50 opacity-0 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
                      >
                        <MaterialIcon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <span className="text-[10px]" style={{ color: accentColor }} aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}
