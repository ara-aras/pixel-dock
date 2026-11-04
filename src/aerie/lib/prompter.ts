// Pure teleprompter maths (tested in scripts/aerie-logic.test.mts).

export interface Script {
  title: string;
  text: string;
  /** Words per minute. */
  wpm: number;
  /** Text size in px. */
  size: number;
  mirror: boolean;
}

export const SCRIPT_COLLECTION = "script";
export const MIN_WPM = 40;
export const MAX_WPM = 400;
export const DEFAULT_SCRIPT: Script = { title: "Untitled script", text: "", wpm: 150, size: 32, mirror: false };

/**
 * Word count that also works for Chinese, Japanese and Thai, which do not separate
 * words with spaces: each CJK/Thai character counts as one word.
 */
export function countWords(text: string): number {
  const dense = (text.match(/[぀-ヿ㐀-鿿豈-﫿฀-๿가-힯]/g) ?? []).length;
  const spaced = text
    .replace(/[぀-ヿ㐀-鿿豈-﫿฀-๿가-힯]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return dense + spaced;
}

/** "3:00", "90", "2m", "1m30s" -> seconds, or null. A bare number means seconds. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  let m = /^(\d+):([0-5]?\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

export const clampWpm = (wpm: number) => Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm)));

/** Speed that reads `text` in `seconds`, clamped to the allowed range. */
export function wpmToFit(text: string, seconds: number): number {
  if (seconds <= 0) return MIN_WPM;
  return clampWpm((countWords(text) * 60) / seconds);
}

/** How long reading takes at `wpm`, in seconds. */
export const readingSeconds = (text: string, wpm: number) => (countWords(text) * 60) / clampWpm(wpm);
