import { useEffect, useRef } from "react";
import { docPut, docsList } from "./db";
import { TODO_COLLECTION, type Todo } from "./todo";

const POLL_MS = 15_000;
let checking = false; // StrictMode runs effects twice in dev; never check concurrently.

/** Polls for due, un-notified to-dos and calls `notify` once per to-do. */
export function useReminders(notify: (message: string) => void) {
  const latest = useRef(notify);
  latest.current = notify;

  useEffect(() => {
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const now = Date.now();
        for (const t of await docsList<Todo>(TODO_COLLECTION)) {
          const d = t.data;
          if (!d.done && d.due !== null && !d.reminded && d.due <= now) {
            await docPut(TODO_COLLECTION, t.id, { ...d, reminded: true });
            latest.current(d.text);
          }
        }
      } catch {
        // Storage hiccup: try again next poll.
      } finally {
        checking = false;
      }
    };
    void check();
    const id = window.setInterval(check, POLL_MS);
    return () => window.clearInterval(id);
  }, []);
}
