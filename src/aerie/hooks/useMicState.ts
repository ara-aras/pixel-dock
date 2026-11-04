import { useCallback, useEffect, useState } from "react";
import { tauriInvoke } from "../../lib/tauri";
import { useAerieEvent } from "./useAerieEvent";

export interface MicState {
  available: boolean;
  muted: boolean;
}

/** Live mic mute state: pushed by the hotkey, polled to catch changes made elsewhere (Windows settings). */
export function useMicState(pollMs = 3000): [MicState, (muted: boolean) => Promise<void>] {
  const [mic, setMic] = useState<MicState>({ available: false, muted: false });

  const refresh = useCallback(() => {
    void tauriInvoke<MicState>("aerie_mic_state", undefined, { silent: true })
      .then((s) => s && setMic(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs]);

  useAerieEvent<MicState>("aerie://mic", setMic);

  const setMuted = useCallback(async (muted: boolean) => {
    const s = await tauriInvoke<MicState>("aerie_mic_set_muted", { muted });
    if (s) setMic(s);
  }, []);

  return [mic, setMuted];
}
