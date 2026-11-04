/** "now", "5m", "3h", "Yesterday", "Nov 2": compact age for list rows. */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  const day = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const days = Math.round((day(now) - day(ms)) / 86_400_000);
  if (days === 0) return `${Math.floor(diff / 3_600_000)}h`;
  if (days === 1) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Group label for history lists, matching Windows/Pixel style sections. */
export function dayGroup(ms: number, now = Date.now()): "Today" | "Yesterday" | "Earlier" {
  const day = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const days = Math.round((day(now) - day(ms)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}
