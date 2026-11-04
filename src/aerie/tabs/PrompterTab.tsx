import { useCallback, useEffect, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import { type Doc, docDelete, docPut, docsList, kvGet, kvSet, newId } from "../lib/store";
import { clampWpm, countWords, DEFAULT_SCRIPT, parseDuration, readingSeconds, SCRIPT_COLLECTION, type Script, wpmToFit } from "../lib/prompter";
import { MaterialIcon } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

const FIELD = "bg-white/10 text-white text-[12px] rounded px-2 py-1 outline-none";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Write scripts here; they play in a small window under the camera. */
export function PrompterTab(_props: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const [scripts, setScripts] = useState<Doc<Script>[]>([]);
  const [current, setCurrent] = useState<{ id: string; data: Script } | null>(null);
  const [fit, setFit] = useState("");
  const [hide, setHide] = useState(true);

  const load = useCallback(() => void docsList<Script>(SCRIPT_COLLECTION).then(setScripts).catch(() => {}), []);
  useEffect(load, [load]);
  useEffect(() => {
    void kvGet("prompter.hide_from_capture").then((v) => setHide(v !== "0"));
  }, []);

  // Autosave the open script.
  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => fireAndForget(docPut(SCRIPT_COLLECTION, current.id, current.data).then(load), "save script"), 400);
    return () => window.clearTimeout(id);
  }, [current, load]);

  const patch = (p: Partial<Script>) => current && setCurrent({ ...current, data: { ...current.data, ...p } });

  const start = () => {
    if (!current) return;
    fireAndForget(
      docPut(SCRIPT_COLLECTION, current.id, current.data).then(() =>
        tauriInvoke("aerie_prompter_open", { scriptId: current.id, hideFromCapture: hide }),
      ),
      "open teleprompter",
    );
  };

  const btn = isMaterial ? "rounded-full bg-primary text-on-primary" : "rounded bg-white/20 text-white";

  if (!current) {
    return (
      <div className="flex flex-col gap-1.5 p-1 min-h-0">
        <button
          type="button"
          onClick={() => setCurrent({ id: newId(), data: { ...DEFAULT_SCRIPT } })}
          className={`flex items-center gap-1 self-start px-3 py-1 text-[11px] font-medium ${btn}`}
        >
          <MaterialIcon name="add" size={14} /> New script
        </button>
        <ul className="flex flex-col gap-1 overflow-y-auto min-h-0" aria-label="Scripts">
          {scripts.length === 0 && <li className="py-2 text-center text-[11px] text-white/50">No scripts yet.</li>}
          {scripts.map((s) => (
            <li key={s.id} className={`group flex items-center gap-1 px-2 py-1 ${isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/8"}`}>
              <button type="button" onClick={() => setCurrent({ id: s.id, data: s.data })} className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-[12px] text-white">{s.data.title}</span>
                <span className="text-[10px] text-white/55">
                  {countWords(s.data.text)} words · {mmss(readingSeconds(s.data.text, s.data.wpm))} at {s.data.wpm} wpm
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${s.data.title}`}
                onClick={() => fireAndForget(docDelete(SCRIPT_COLLECTION, s.id).then(load), "delete script")}
                className="rounded-full p-0.5 text-white/55 opacity-0 hover:text-red-400 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <MaterialIcon name="delete" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const s = current.data;
  return (
    <div className="flex flex-col gap-1.5 p-1">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setCurrent(null)} aria-label="Back to scripts" className="rounded-full p-0.5 text-white/70 hover:bg-white/10">
          <MaterialIcon name="close" size={16} />
        </button>
        <input value={s.title} onChange={(e) => patch({ title: e.target.value })} aria-label="Script title" className={`${FIELD} flex-1`} />
      </div>
      <textarea
        value={s.text}
        onChange={(e) => patch({ text: e.target.value.slice(0, 100_000) })}
        rows={5}
        placeholder="Write or paste what you want to read."
        aria-label="Script text"
        className={`${FIELD} resize-none`}
      />
      <div className="flex items-center gap-2 text-[11px] text-white/80">
        <label className="flex flex-1 items-center gap-1">
          Speed
          <input type="range" min={40} max={400} step={10} value={s.wpm} onChange={(e) => patch({ wpm: clampWpm(Number(e.target.value)) })} className="flex-1" aria-label="Words per minute" />
          <span className="w-14 text-right">{s.wpm} wpm</span>
        </label>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-white/80">
        <label className="flex flex-1 items-center gap-1">
          Size
          <input type="range" min={20} max={120} step={2} value={s.size} onChange={(e) => patch({ size: Number(e.target.value) })} className="flex-1" aria-label="Text size" />
          <span className="w-10 text-right">{s.size}px</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/80">
        <label className="flex items-center gap-1">
          Fit to
          <input
            value={fit}
            onChange={(e) => setFit(e.target.value)}
            onKeyDown={(e) => {
              const secs = e.key === "Enter" ? parseDuration(fit) : null;
              if (secs) patch({ wpm: wpmToFit(s.text, secs) });
            }}
            placeholder="3:00"
            aria-label="Fit reading to this duration, then press Enter"
            className={`${FIELD} w-14`}
          />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.mirror} onChange={(e) => patch({ mirror: e.target.checked })} /> Mirror
        </label>
        <label className="flex items-center gap-1" title="People watching your screen share or recording do not see it. Needs Windows 10 2004 or newer.">
          <input
            type="checkbox"
            checked={hide}
            onChange={(e) => {
              setHide(e.target.checked);
              fireAndForget(kvSet("prompter.hide_from_capture", e.target.checked ? "1" : "0"), "save capture setting");
            }}
          />
          Hide from screen sharing
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={start} disabled={!s.text.trim()} className={`flex items-center gap-1 px-3 py-1 text-[11px] font-medium disabled:opacity-40 ${btn}`}>
          <MaterialIcon name="subtitles" size={14} /> Start reading
        </button>
        <span className="text-[10px] text-white/55">
          {countWords(s.text)} words · {mmss(readingSeconds(s.text, s.wpm))}
        </span>
      </div>
      <p className="text-[10px] text-white/45">Ctrl+Alt+P play/pause · Ctrl+Alt+Shift+↑/↓ speed · Esc closes</p>
    </div>
  );
}
