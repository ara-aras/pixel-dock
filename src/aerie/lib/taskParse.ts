import * as chrono from "chrono-node";

// Pure natural-language task parsing (no React/Tauri), tested in scripts/aerie-logic.test.mts.

export interface ParsedTask {
  title: string;
  /** Epoch ms, or null when no date was found. */
  dueAt: number | null;
  /** False when only a day was given; the reminder then fires at DEFAULT_HOUR. */
  hasTime: boolean;
}

/** Hour used for date-only tasks ("pay rent on friday"). */
export const DEFAULT_HOUR = 9;

/** "call mom tomorrow 5pm" -> { title: "call mom", dueAt: tomorrow 17:00, hasTime: true } */
export function parseTask(input: string, now: Date = new Date()): ParsedTask {
  const text = input.trim();
  const hit = chrono.parse(text, now, { forwardDate: true })[0];
  if (!hit) return { title: text, dueAt: null, hasTime: false };

  const hasTime = hit.start.isCertain("hour");
  const date = hit.start.date();
  if (!hasTime) date.setHours(DEFAULT_HOUR, 0, 0, 0);

  const title = `${text.slice(0, hit.index)} ${text.slice(hit.index + hit.text.length)}`
    .replace(/\s+/g, " ")
    .replace(/\s+(at|on|by|due|before)$/i, "")
    .trim();
  return { title: title || text, dueAt: date.getTime(), hasTime };
}

/** "Today 5:00 PM", "Tomorrow", "Nov 9", with time only when one was given. */
export function formatDue(dueAt: number, hasTime = true, now: Date = new Date()): string {
  const d = new Date(dueAt);
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dayStart(d) - dayStart(now)) / 86_400_000);
  const day =
    diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : d.toLocaleDateString([], { month: "short", day: "numeric" });
  return hasTime ? `${day} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : day;
}

/**
 * PILLAR's TaskItem stores only a timestamp, so "was a time given?" is inferred:
 * exactly DEFAULT_HOUR:00 is treated as a date-only task.
 */
export const looksDateOnly = (dueAt: number) => {
  const d = new Date(dueAt);
  return d.getHours() === DEFAULT_HOUR && d.getMinutes() === 0;
};
