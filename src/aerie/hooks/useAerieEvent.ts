import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/** Subscribe to a backend event for the component's lifetime. No-op outside Tauri. */
export function useAerieEvent<T = unknown>(name: string, onEvent: (payload: T) => void): void {
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    listen<T>(name, (e) => {
      if (!disposed) latest.current(e.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Plain browser: no backend events.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name]);
}
