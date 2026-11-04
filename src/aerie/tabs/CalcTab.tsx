import { useEffect, useMemo, useState } from "react";
import { calculate } from "../lib/calc";
import type { AerieTabProps } from "./types";

interface Entry {
  expr: string;
  result: string;
}

const HISTORY_KEY = "aerie.calc.history";
const HISTORY_MAX = 25;

function loadHistory(): Entry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is Entry => typeof e?.expr === "string" && typeof e?.result === "string")
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(history: Entry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Non-fatal: history just will not persist.
  }
}

export function CalcTab({ accentColor }: AerieTabProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Entry[]>(loadHistory);
  const [copied, setCopied] = useState(false);
  const live = useMemo(() => calculate(input), [input]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(id);
  }, [copied]);

  const commit = () => {
    if (live === null) return;
    const next = [{ expr: input.trim(), result: live }, ...history].slice(0, HISTORY_MAX);
    setHistory(next);
    saveHistory(next);
    setInput(live);
  };

  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className="flex flex-col gap-1.5 p-1 min-h-0">
      <span className="text-white/85 text-[11px] uppercase tracking-wider">Calculator</span>
      <input
        autoFocus
        value={input}
        spellCheck={false}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder='Try "15% of 240" or "5 km to miles"'
        aria-label="Expression"
        className="bg-white/10 text-white text-[14px] rounded px-2 py-1 outline-none"
      />
      <button
        type="button"
        disabled={live === null}
        onClick={() => live && copy(live)}
        title="Click to copy"
        aria-label={live === null ? "No result" : `Result ${live}. Click to copy.`}
        className="min-h-[24px] text-left text-[16px] font-medium disabled:cursor-default"
        style={{ color: live === null ? "rgba(255,255,255,0.4)" : accentColor }}
      >
        {live === null ? (input.trim() ? "…" : "") : `= ${live}`}
        {copied && <span className="ml-1 text-[11px] text-white/60">copied</span>}
      </button>
      {history.length > 0 && (
        <ul className="flex flex-col gap-px overflow-y-auto min-h-0" aria-label="History">
          {history.map((h, i) => (
            <li key={`${h.expr}-${i}`}>
              <button
                type="button"
                onClick={() => setInput(h.result)}
                className="flex w-full justify-between gap-2 rounded px-1.5 py-0.5 text-left text-[11px] text-white/85 hover:bg-white/10"
              >
                <span className="truncate text-white/60">{h.expr}</span>
                <span className="shrink-0">{h.result}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
