import { useEffect, useRef, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { useHotkeys } from "../hooks/useHotkeys";
import { useMicState } from "../hooks/useMicState";
import { MaterialIcon } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

/** Mic mute for every app (Windows level) and a private camera mirror. */
export function MicTab(_props: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const [mic, setMuted] = useMicState(2000);
  const hotkey = useHotkeys().label("mic");
  const video = useRef<HTMLVideoElement>(null);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  useEffect(() => {
    if (!camOn) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 360 } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => {
        setCamError("Camera unavailable or access blocked.");
        setCamOn(false);
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop()); // camera light goes off when you leave
    };
  }, [camOn]);

  const big = isMaterial
    ? mic.muted
      ? "rounded-[28px] bg-error-container text-on-error-container"
      : "rounded-[28px] bg-primary-container text-on-primary-container"
    : mic.muted
      ? "rounded-xl bg-red-500/30 text-white"
      : "rounded-xl bg-white/15 text-white";

  return (
    <div className="flex flex-col gap-2 p-1">
      <button
        type="button"
        disabled={!mic.available}
        onClick={() => fireAndForget(setMuted(!mic.muted), "toggle mic")}
        aria-pressed={mic.muted}
        aria-label={mic.available ? (mic.muted ? "Microphone muted. Unmute" : "Microphone live. Mute") : "No microphone"}
        className={`flex items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-50 ${big}`}
      >
        <MaterialIcon name={mic.muted ? "mic_off" : "mic"} size={28} filled />
        <span className="flex flex-col">
          <span className="text-[14px] font-medium">{!mic.available ? "No microphone" : mic.muted ? "Muted" : "Live"}</span>
          <span className="text-[10px] opacity-80">Every app hears {mic.muted ? "silence" : "you"}</span>
        </span>
      </button>
      <p className="px-1 text-[10px] text-white/55">
        {hotkey
          ? `${hotkey}: tap to mute or unmute. While muted, hold it to talk; let go to mute again.`
          : "No shortcut: every combination Aerie tries is used by another app. The button above still works."}
      </p>

      <div className={`flex flex-col gap-1.5 p-2 ${isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-[12px] text-white">
            <MaterialIcon name="videocam" size={16} /> Camera mirror
          </span>
          <button
            type="button"
            onClick={() => {
              setCamError(null);
              setCamOn((on) => !on);
            }}
            className={`px-2.5 py-0.5 text-[11px] font-medium ${isMaterial ? "rounded-full bg-secondary-container text-on-secondary-container" : "rounded bg-white/15 text-white"}`}
          >
            {camOn ? "Stop" : "Start preview"}
          </button>
        </div>
        {camOn && (
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            className={`aspect-video w-full -scale-x-100 object-cover ${isMaterial ? "rounded-xl" : "rounded"}`}
            aria-label="Your camera, mirrored"
          />
        )}
        <span className="text-[10px] text-white/50">{camError ?? "Only you see this. Nothing is recorded."}</span>
      </div>
    </div>
  );
}
