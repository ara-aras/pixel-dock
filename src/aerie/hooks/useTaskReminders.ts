import { useEffect, useRef } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { TaskItem } from "../../types/productivity";
import { kvGetJson, kvSetJson } from "../lib/store";

const POLL_MS = 15_000;
const KEY = "task.reminded";
/** Forget reminded ids after this many, oldest first. */
const MAX_REMEMBERED = 500;

/**
 * Sends a Windows notification once for each open task whose due time has passed.
 * PILLAR already mirrors Windows notifications into the pill, so the reminder shows
 * there too, and it reaches Action Center even while the overlay is hidden.
 */
export function useTaskReminders(tasks: TaskItem[]) {
  const latest = useRef(tasks);
  latest.current = tasks;

  useEffect(() => {
    let disposed = false;
    let busy = false;

    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const now = Date.now();
        const due = latest.current.filter((t) => !t.completed && t.dueAt !== undefined && t.dueAt <= now);
        if (due.length === 0) return;
        const reminded = new Set(await kvGetJson<string[]>(KEY, []));
        const fresh = due.filter((t) => !reminded.has(t.id));
        if (fresh.length === 0 || disposed) return;

        let allowed = await isPermissionGranted().catch(() => false);
        if (!allowed) allowed = (await requestPermission().catch(() => "denied")) === "granted";

        for (const task of fresh) {
          if (allowed) sendNotification({ title: "Reminder", body: task.title });
          reminded.add(task.id);
        }
        await kvSetJson(KEY, [...reminded].slice(-MAX_REMEMBERED));
      } catch {
        // Not in Tauri or storage busy: try again next poll.
      } finally {
        busy = false;
      }
    };

    void check();
    const id = window.setInterval(check, POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, []);
}
