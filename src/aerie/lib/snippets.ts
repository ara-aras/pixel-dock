// Pure snippet placeholder logic (tested in scripts/aerie-logic.test.mts).

export interface Snippet {
  title: string;
  body: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Labels of `{?label}` fill-in blanks, in order of first appearance, without repeats. */
export function fillLabels(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\?([^}]+)\}/g)].map((m) => m[1].trim()))];
}

/** Replace {date}, {time}, {clipboard} and {?label}. Unknown {words} are left as typed. */
export function expandSnippet(
  body: string,
  ctx: { now?: Date; clipboard?: string; fills?: Record<string, string> } = {},
): string {
  const d = ctx.now ?? new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return body
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{clipboard\}/g, () => ctx.clipboard ?? "")
    .replace(/\{\?([^}]+)\}/g, (_, label: string) => ctx.fills?.[label.trim()] ?? "");
}
