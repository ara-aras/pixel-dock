import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Calls `onChange(false)` when the overlay is hidden (hotkey, tray or settings) and
 * `onChange(true)` when it is shown again. The pill uses it to collapse before hiding.
 */
export function useVisibilityEvents(onChange: (visible: boolean) => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    listen<boolean>("aerie://visibility", (event) => {
      if (!disposed) latest.current(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Not running inside Tauri (plain browser): nothing to listen to.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
