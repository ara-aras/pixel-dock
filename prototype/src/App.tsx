import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { useReminders } from "./reminders";
import { type IdleLook, type PanelSize, useSettings } from "./settings";
import { TABS } from "./tabs";
import { pillSummary, setFinishedHandler, useTimers } from "./timerStore";
import { useNow } from "./useNow";

// Logical (CSS) pixels. The Rust side scales these for the target monitor.
const IDLE: Record<IdleLook, { w: number; h: number }> = {
  pill: { w: 200, h: 36 },
  slim: { w: 96, h: 6 },
};
const PANEL: Record<PanelSize, { w: number; h: number }> = {
  s: { w: 420, h: 260 },
  m: { w: 520, h: 340 },
  l: { w: 640, h: 440 },
};

// Reminders and finished timers widen the idle pill briefly to show a message.
const ALERT = { w: 360, h: 40 };
const ALERT_MS = 8000;

// Hover mode waits before opening so passing the cursor over the pill does nothing.
const HOVER_DWELL_MS = 350;
const CLOSE_DELAY_MS = 350;
// Keep the full-size panel mounted until the window has finished shrinking (Rust anim is 170 ms).
const UNMOUNT_AFTER_MS = 210;

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [tabId, setTabId] = useState(TABS[0].id);
  const [monitorCount, setMonitorCount] = useState(1);
  const [alert, setAlert] = useState<string | null>(null);
  const now = useNow();
  const timers = useTimers();
  const timer = useRef<number>(0);
  const alertTimer = useRef<number>(0);
  const placed = useRef<string | null>(null);

  const expanded = open || pinned;
  const mode = expanded ? "panel" : alert ? "alert" : "idle";
  const summary = pillSummary(timers, now.getTime());

  const notify = useCallback((message: string) => {
    window.clearTimeout(alertTimer.current);
    setAlert(message);
    alertTimer.current = window.setTimeout(() => setAlert(null), ALERT_MS);
  }, []);

  useReminders(notify);
  useEffect(() => {
    setFinishedHandler(notify);
    return () => window.clearTimeout(alertTimer.current);
  }, [notify]);

  const schedule = useCallback((next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    invoke<number>("monitor_count")
      .then(setMonitorCount)
      .catch(() => {});
  }, []);

  // Hiding the notch (hotkey or tray) must also drop any open state.
  useEffect(() => {
    const unlisten = listen<boolean>("notch-visibility", (e) => {
      if (!e.payload) {
        window.clearTimeout(timer.current);
        setOpen(false);
        setPinned(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keep the OS window in sync with the UI state. Only mode changes (idle, alert,
  // panel) animate; changing size, edge or monitor snaps.
  useEffect(() => {
    const size = mode === "panel" ? PANEL[settings.size] : mode === "alert" ? ALERT : IDLE[settings.idle];
    const animate = placed.current !== null && placed.current !== mode;
    placed.current = mode;
    invoke("place_notch", {
      width: size.w,
      height: size.h,
      edge: settings.edge,
      monitorIndex: settings.monitor,
      animate,
    }).catch(() => {});
  }, [mode, settings.size, settings.idle, settings.edge, settings.monitor]);

  useEffect(() => {
    if (expanded) {
      setShowPanel(true);
      return;
    }
    const id = window.setTimeout(() => setShowPanel(false), UNMOUNT_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [expanded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.clearTimeout(timer.current);
        setPinned(false);
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onEnter = () => {
    if (expanded) {
      window.clearTimeout(timer.current); // cancel a pending close
    } else if (settings.openOn === "hover") {
      schedule(true, HOVER_DWELL_MS);
    }
  };

  const onLeave = () => {
    if (expanded) schedule(false, CLOSE_DELAY_MS);
    else window.clearTimeout(timer.current); // cancel a pending open
  };

  const openNow = () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(alertTimer.current);
    setAlert(null);
    setOpen(true);
  };

  const active = TABS.find((t) => t.id === tabId) ?? TABS[0];
  const panelSize = PANEL[settings.size];

  return (
    <div
      className={`notch edge-${settings.edge}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {showPanel ? (
        <section
          className={`panel edge-${settings.edge}`}
          style={{ width: panelSize.w, height: panelSize.h }}
        >
          <header className="bar">
            <nav className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={t.id === active.id ? "on" : ""}
                  onClick={() => setTabId(t.id)}
                >
                  {t.title}
                </button>
              ))}
            </nav>
            <button
              className="pin"
              title={pinned ? "Unpin (Esc)" : "Keep open"}
              aria-pressed={pinned}
              onClick={() => setPinned((p) => !p)}
            >
              {pinned ? "Pinned" : "Pin"}
            </button>
          </header>
          <main className="content">
            <active.Component
              settings={settings}
              updateSettings={updateSettings}
              monitorCount={monitorCount}
            />
          </main>
        </section>
      ) : alert ? (
        <button className="pill-face alert" onClick={openNow} aria-label={`Alert: ${alert}`}>
          {alert}
        </button>
      ) : settings.idle === "slim" && !summary ? (
        <button className="slim-face" onClick={openNow} aria-label="Open Aerie" />
      ) : (
        <button
          className="pill-face"
          data-timer={summary ? "on" : undefined}
          style={{ "--p": `${(summary?.progress ?? 0) * 100}%` } as CSSProperties}
          onClick={openNow}
          aria-label="Open Aerie"
        >
          {summary?.label ?? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </button>
      )}
    </div>
  );
}
