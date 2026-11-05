import { useCallback, useEffect, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import { useAerieEvent } from "../hooks/useAerieEvent";
import { useHotkeys } from "../hooks/useHotkeys";
import { type Doc, docDelete, docPut, docsList } from "../lib/store";
import { relativeTime } from "../lib/time";
import { clearRecorderError, toggleRecording, useVoiceRecorder, VOICE_COLLECTION, type VoiceMemo } from "../lib/voiceRecorder";
import { MaterialIcon } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

function MemoRow({ memo, onChanged }: { memo: Doc<VoiceMemo>; onChanged: () => void }) {
  const { isMaterial } = useAerieThemeContext();
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState(memo.data.name);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);

  const rename = () => {
    const next = name.trim();
    if (next && next !== memo.data.name) fireAndForget(docPut(VOICE_COLLECTION, memo.id, { ...memo.data, name: next }).then(onChanged), "rename memo");
  };

  const remove = async () => {
    await tauriInvoke("aerie_voice_delete", { file: memo.data.file });
    await docDelete(VOICE_COLLECTION, memo.id);
    onChanged();
  };

  return (
    <li className={`flex flex-col gap-1 px-2 py-1.5 ${isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/8"}`}>
      <div className="flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Memo name"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none"
        />
        <span className="text-[10px] text-white/50">
          {clock(memo.data.durationMs)} · {relativeTime(memo.data.created)}
        </span>
      </div>
      {src ? (
        <audio src={src} controls autoPlay className="h-8 w-full" />
      ) : (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void tauriInvoke<string>("aerie_voice_load", { file: memo.data.file }).then(setSrc).catch(() => {})}
            className={`px-2 py-0.5 text-[11px] ${isMaterial ? "rounded-full bg-secondary-container text-on-secondary-container" : "rounded bg-white/15 text-white"}`}
          >
            Play
          </button>
          <button
            type="button"
            onClick={() => fireAndForget(tauriInvoke("aerie_voice_reveal", { file: memo.data.file }), "show memo")}
            className="rounded-full px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
          >
            Show in folder
          </button>
          <button
            type="button"
            onClick={() => (armed ? fireAndForget(remove(), "delete memo") : setArmed(true))}
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] hover:bg-white/10 ${armed ? "text-red-400" : "text-white/60"}`}
          >
            {armed ? "Delete for good?" : "Delete"}
          </button>
        </div>
      )}
    </li>
  );
}

/** Voice memos: Ctrl+Alt+R from any app. Stored on this PC, never uploaded. */
export function VoiceTab(_props: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const rec = useVoiceRecorder();
  const hotkey = useHotkeys().label("voice");
  const [memos, setMemos] = useState<Doc<VoiceMemo>[]>([]);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => void docsList<VoiceMemo>(VOICE_COLLECTION).then(setMemos).catch(() => {}), []);
  useEffect(load, [load, rec.recording]);
  useAerieEvent("aerie://voice", () => window.setTimeout(load, 800));

  useEffect(() => {
    if (!rec.recording) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [rec.recording]);

  return (
    <div className="flex flex-col gap-2 p-1 min-h-0">
      <button
        type="button"
        onClick={toggleRecording}
        aria-pressed={rec.recording}
        className={`flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
          rec.recording
            ? isMaterial
              ? "rounded-[28px] bg-error text-on-error"
              : "rounded-xl bg-red-500 text-fixed-white"
            : isMaterial
              ? "rounded-[28px] bg-primary-container text-on-primary-container"
              : "rounded-xl bg-white/15 text-white"
        }`}
      >
        <MaterialIcon name={rec.recording ? "graphic_eq" : "mic"} size={20} filled />
        {rec.recording ? `Stop · ${clock(now - rec.startedAt)}` : "Record a memo"}
      </button>
      <p className="px-1 text-[10px] text-white/55">
        {hotkey ? `${hotkey} starts and stops recording from any app.` : "No shortcut free; use the button."} Up to 2 hours.
      </p>
      {rec.error && (
        <button type="button" onClick={clearRecorderError} className="px-1 text-left text-[11px] text-red-400">
          {rec.error}
        </button>
      )}
      <ul className="flex flex-col gap-1 overflow-y-auto min-h-0" aria-label="Voice memos">
        {memos.length === 0 && <li className="py-2 text-center text-[11px] text-white/50">No memos yet.</li>}
        {memos.map((m) => (
          <MemoRow key={m.id} memo={m} onChanged={load} />
        ))}
      </ul>
    </div>
  );
}
