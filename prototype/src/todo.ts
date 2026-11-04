import * as chrono from "chrono-node";

export interface Todo {
  text: string;
  done: boolean;
  /** Epoch ms, or null when the task has no date. */
  due: number | null;
  /** False when the user gave only a date; reminders then fire at 09:00. */
  hasTime: boolean;
  reminded: boolean;
  created: number;
}

export const TODO_COLLECTION = "todo";

/** "call mom tomorrow 5pm" -> { text: "call mom", due: tomorrow 17:00 }. */
export function parseTodo(input: string): Pick<Todo, "text" | "due" | "hasTime"> {
  const trimmed = input.trim();
  const hit = chrono.parse(trimmed, new Date(), { forwardDate: true })[0];
  if (!hit) return { text: trimmed, due: null, hasTime: false };

  const hasTime = hit.start.isCertain("hour");
  const date = hit.start.date();
  if (!hasTime) date.setHours(9, 0, 0, 0);

  const rest = (trimmed.slice(0, hit.index) + " " + trimmed.slice(hit.index + hit.text.length))
    .replace(/\s+/g, " ")
    .replace(/\s+(at|on|by|due|before)$/i, "")
    .trim();
  return { text: rest || trimmed, due: date.getTime(), hasTime };
}

export function formatDue(due: number, hasTime: boolean): string {
  const d = new Date(due);
  const today = new Date();
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(d) - dayStart(today)) / 86_400_000);
  const day =
    diffDays === 0
      ? "Today"
      : diffDays === 1
        ? "Tomorrow"
        : diffDays === -1
          ? "Yesterday"
          : d.toLocaleDateString([], { month: "short", day: "numeric" });
  return hasTime ? `${day} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : day;
}
