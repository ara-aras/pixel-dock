import { useSyncExternalStore } from "react";
import { tauriInvoke } from "../../lib/tauri";
import { docPut, newId } from "./store";

// Voice memo recorder. Lives outside React so recording continues while the panel
// is closed, and the Ctrl+Alt+R hotkey works from anywhere.

export interface VoiceMemo {
  name: string;
  file: string;
  durationMs: number;
  created: number;
}

export const VOICE_COLLECTION = "voice";
const MAX_MS = 2 * 60 * 60 * 1000; // 2 hours
const CHUNK_MS = 4000;

interface RecorderState {
  recording: boolean;
  startedAt: number;
  error: string | null;
}

let state: RecorderState = { recording: false, startedAt: 0, error: null };
const listeners = new Set<() => void>();
const emit = (patch: Partial<RecorderState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let writes: Promise<unknown> = Promise.resolve();
let stopTimer: number | undefined;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function startRecording(): Promise<void> {
  if (state.recording) return;
  const mic = await tauriInvoke<{ available: boolean; muted: boolean }>("aerie_mic_state", undefined, { silent: true }).catch(() => null);
  if (mic && !mic.available) return emit({ error: "No microphone found." });
  if (mic?.muted) return emit({ error: "Your microphone is muted (Ctrl+Alt+M). Unmute it to record." });

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    return emit({ error: "Microphone access was blocked." });
  }

  const file = `${newId()}.webm`;
  const startedAt = Date.now();
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
  writes = Promise.resolve();

  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    // Chain writes so chunks land in order.
    writes = writes.then(async () => tauriInvoke("aerie_voice_append", { file, chunk: await blobToBase64(e.data) }));
  };
  recorder.onstop = async () => {
    window.clearTimeout(stopTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    try {
      await writes;
      const created = Date.now();
      const label = new Date(startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      await docPut<VoiceMemo>(VOICE_COLLECTION, file.replace(".webm", ""), {
        name: `Voice memo, ${label}`,
        file,
        durationMs: created - startedAt,
        created,
      });
      emit({ recording: false, error: null });
    } catch {
      emit({ recording: false, error: "Could not save the recording." });
    }
  };

  recorder.start(CHUNK_MS);
  stopTimer = window.setTimeout(stopRecording, MAX_MS);
  emit({ recording: true, startedAt, error: null });
}

export function stopRecording(): void {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

export const toggleRecording = () => (state.recording ? stopRecording() : void startRecording());
export const clearRecorderError = () => emit({ error: null });

export function useVoiceRecorder(): RecorderState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
