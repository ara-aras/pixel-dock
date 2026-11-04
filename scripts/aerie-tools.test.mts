// Logic tests for Aerie tools: natural-language tasks, snippets, teleprompter maths, time labels.
// Run: npx tsx scripts/aerie-tools.test.mts
import { formatDue, looksDateOnly, parseTask, DEFAULT_HOUR } from "../src/aerie/lib/taskParse.ts";
import { expandSnippet, fillLabels } from "../src/aerie/lib/snippets.ts";
import { countWords, parseDuration, wpmToFit, readingSeconds, clampWpm } from "../src/aerie/lib/prompter.ts";
import { relativeTime, dayGroup } from "../src/aerie/lib/time.ts";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", label.padEnd(44), JSON.stringify(got), ok ? "" : `(want ${JSON.stringify(want)})`);
};

// Fixed "now": Wednesday 4 Nov 2026, 14:00 local time.
const now = new Date(2026, 10, 4, 14, 0, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

// --- tasks
eq("task: tomorrow 5pm", parseTask("call mom tomorrow 5pm", now), { title: "call mom", dueAt: at(5, 17), hasTime: true });
eq("task: no date", parseTask("buy milk", now), { title: "buy milk", dueAt: null, hasTime: false });
eq("task: date only -> default hour", parseTask("pay rent on friday", now), { title: "pay rent", dueAt: at(6, DEFAULT_HOUR), hasTime: false });
eq("task: time already passed today -> tomorrow", parseTask("standup at 9am", now).dueAt, at(5, 9));
eq("task: only a date keeps original text", parseTask("tomorrow", now).title, "tomorrow");
eq("formatDue today with time", formatDue(at(4, 17), true, now).startsWith("Today"), true);
eq("formatDue tomorrow date-only", formatDue(at(5, 9), false, now), "Tomorrow");
eq("looksDateOnly 9:00", looksDateOnly(at(6, 9)), true);
eq("looksDateOnly 9:30", looksDateOnly(at(6, 9, 30)), false);

// --- snippets
eq("fill labels deduped, in order", fillLabels("Hi {?name}, re {?topic}. Bye {?name}"), ["name", "topic"]);
eq(
  "expand all placeholders",
  expandSnippet("{date} {time} [{clipboard}] {?who} {unknown}", { now, clipboard: "X", fills: { who: "Sam" } }),
  "2026-11-04 14:00 [X] Sam {unknown}",
);
eq("expand: $ in clipboard is literal", expandSnippet("{clipboard}", { clipboard: "$& $1" }), "$& $1");

// --- teleprompter
eq("words: english", countWords("one two  three\nfour"), 4);
eq("words: CJK counts characters", countWords("你好世界"), 4);
eq("words: mixed", countWords("hello 世界"), 3);
eq("duration 3:00", parseDuration("3:00"), 180);
eq("duration 90", parseDuration("90"), 90);
eq("duration 2m", parseDuration("2m"), 120);
eq("duration 1m30s", parseDuration("1m30s"), 90);
eq("duration junk", parseDuration("soon"), null);
eq("fit 300 words in 2:00 = 150 wpm", wpmToFit(Array(300).fill("w").join(" "), 120), 150);
eq("fit clamps to max", wpmToFit(Array(3000).fill("w").join(" "), 10), 400);
eq("reading seconds", readingSeconds(Array(150).fill("w").join(" "), 150), 60);
eq("clamp low", clampWpm(5), 40);

// --- time labels
const n = now.getTime();
eq("relative now", relativeTime(n - 10_000, n), "now");
eq("relative minutes", relativeTime(n - 5 * 60_000, n), "5m");
eq("relative yesterday", relativeTime(at(3, 13), n), "Yesterday");
eq("group today", dayGroup(at(4, 1), n), "Today");
eq("group earlier", dayGroup(at(1, 12), n), "Earlier");

console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
