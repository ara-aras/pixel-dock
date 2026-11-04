import { useCallback, useEffect, useRef, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import { useSettings } from "../../hooks/useSettings";
import { useAerieEvent } from "../hooks/useAerieEvent";
import { clampWpm, countWords, type Script, SCRIPT_COLLECTION } from "../lib/prompter";
import { docsList, docPut, kvGet, kvSet } from "../lib/store";
import { useAerieTheme } from "../theme/useAerieTheme";

const COUNTDOWN_S = 3;
const STEP_WPM = 10;

/** The teleprompter window (opened by aerie_prompter_open at #prompter/<scriptId>). */
export function PrompterWindow({ scriptId }: { scriptId: string }) {
  const { settings } = useSettings();
  useAerieTheme(settings.aerie, settings.appearance.accent_color, null); // same palette as the pill

  const [script, setScript] = useState<Script | null>(null);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [wpm, setWpm] = useState(150);
  const scroller = useRef<HTMLDivElement>(null);
  const progressKey = `prompter.progress.${scriptId}`;

  useEffect(() => {
    void docsList<Script>(SCRIPT_COLLECTION).then(async (all) => {
      const found = all.find((d) => d.id === scriptId)?.data ?? null;
      setScript(found);
      if (found) setWpm(found.wpm);
      const saved = Number((await kvGet(progressKey)) ?? 0);
      requestAnimationFrame(() => scroller.current && (scroller.current.scrollTop = saved));
    });
  }, [scriptId, progressKey]);

  // Scroll at a speed that covers the whole text in (words / wpm) minutes.
  useEffect(() => {
    if (!playing || !script) return;
    const el = scroller.current;
    if (!el) return;
    const words = Math.max(1, countWords(script.text));
    let last = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const distance = el.scrollHeight - el.clientHeight;
      const pxPerSec = distance / ((words / wpm) * 60);
      el.scrollTop += (pxPerSec * (t - last)) / 1000;
      last = t;
      if (el.scrollTop >= distance - 1) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, wpm, script]);

  // Remember where we were.
  useEffect(() => {
    if (playing) return;
    const top = scroller.current?.scrollTop ?? 0;
    fireAndForget(kvSet(progressKey, String(Math.round(top))), "save prompter position");
  }, [playing, progressKey]);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = window.setTimeout(() => (countdown === 1 ? (setCountdown(0), setPlaying(true)) : setCountdown(countdown - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [countdown]);

  const toggle = useCallback(() => {
    if (playing || countdown) {
      setPlaying(false);
      setCountdown(0);
    } else setCountdown(COUNTDOWN_S);
  }, [playing, countdown]);

  const changeSpeed = useCallback(
    (delta: number) =>
      setWpm((w) => {
        const next = clampWpm(w + delta);
        if (script) fireAndForget(docPut(SCRIPT_COLLECTION, scriptId, { ...script, wpm: next }), "save speed");
        return next;
      }),
    [script, scriptId],
  );

  const close = () => fireAndForget(tauriInvoke("aerie_prompter_close"), "close teleprompter");

  useAerieEvent<string>("aerie://prompter", (cmd) => {
    if (cmd === "toggle") toggle();
    else if (cmd === "faster") changeSpeed(STEP_WPM);
    else if (cmd === "slower") changeSpeed(-STEP_WPM);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") (e.preventDefault(), toggle());
      else if (e.key === "ArrowUp") changeSpeed(STEP_WPM);
      else if (e.key === "ArrowDown") changeSpeed(-STEP_WPM);
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, changeSpeed]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-[24px] bg-surface-container/95 text-on-surface" data-tauri-drag-region>
      <div className="flex items-center gap-2 px-3 pt-2 text-[11px] text-on-surface-variant" data-tauri-drag-region>
        <button type="button" onClick={toggle} className="rounded-full bg-primary px-3 py-0.5 font-medium text-on-primary">
          {playing ? "Pause" : countdown ? `${countdown}…` : "Play"}
        </button>
        <button type="button" onClick={() => changeSpeed(-STEP_WPM)} aria-label="Slower" className="rounded-full px-2 hover:bg-on-surface/10">−</button>
        <span>{wpm} wpm</span>
        <button type="button" onClick={() => changeSpeed(STEP_WPM)} aria-label="Faster" className="rounded-full px-2 hover:bg-on-surface/10">+</button>
        <span className="ml-auto truncate">{script?.title ?? ""}</span>
        <button type="button" onClick={close} aria-label="Close teleprompter" className="rounded-full px-2 hover:bg-on-surface/10">✕</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {/* soft reading line */}
        <div className="pointer-events-none absolute inset-x-0 top-[30%] h-px bg-primary/40" aria-hidden="true" />
        <div
          ref={scroller}
          className="h-full overflow-y-auto px-5 pb-[60vh] pt-2 leading-snug [scrollbar-width:none]"
          style={{ fontSize: script?.size ?? 32, transform: script?.mirror ? "scaleX(-1)" : undefined }}
        >
          {script ? script.text : "Script not found."}
        </div>
      </div>
    </div>
  );
}
