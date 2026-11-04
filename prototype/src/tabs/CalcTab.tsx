import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { all, create } from "mathjs";
import { useEffect, useMemo, useState } from "react";
import { kvGet, kvSet } from "../db";

const math = create(all);
const evaluate = math.evaluate.bind(math);

// The expression parser can import code and define units; the input is typed by the
// user but may be pasted from anywhere, so switch those features off.
math.import(
  {
    import: () => {
      throw new Error("disabled");
    },
    createUnit: () => {
      throw new Error("disabled");
    },
    evaluate: () => {
      throw new Error("disabled");
    },
    parse: () => {
      throw new Error("disabled");
    },
    simplify: () => {
      throw new Error("disabled");
    },
    derivative: () => {
      throw new Error("disabled");
    },
  },
  { override: true },
);

/** Turn plain-language input into something mathjs understands. */
function normalize(input: string): string {
  return input
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+(.+)/gi, "(($1)/100)*($2)")
    .replace(/\s+plus\s+/gi, " + ")
    .replace(/\s+minus\s+/gi, " - ")
    .replace(/\s+times\s+/gi, " * ")
    .replace(/\s+divided by\s+/gi, " / ")
    .replace(/\s+in\s+(?=[a-z°])/gi, " to ");
}

export function calculate(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const result = evaluate(normalize(text));
    if (result === undefined || typeof result === "function") return null;
    return math.format(result, { precision: 12 });
  } catch {
    return null;
  }
}

interface Entry {
  expr: string;
  result: string;
}

const HISTORY_KEY = "calc.history";
const HISTORY_MAX = 25;

export function CalcTab() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const [copied, setCopied] = useState(false);
  const live = useMemo(() => calculate(input), [input]);

  useEffect(() => {
    kvGet(HISTORY_KEY)
      .then((v) => v && setHistory(JSON.parse(v)))
      .catch(() => {});
  }, []);

  const commit = () => {
    if (live === null) return;
    const next = [{ expr: input.trim(), result: live }, ...history].slice(0, HISTORY_MAX);
    setHistory(next);
    kvSet(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
    setInput(live);
  };

  const copy = async (text: string) => {
    await writeText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="calc">
      <input
        className="field big"
        autoFocus
        value={input}
        placeholder='Try "15% of 240" or "5 km to miles"'
        spellCheck={false}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <button
        className="calc-live"
        disabled={live === null}
        onClick={() => live && copy(live)}
        title="Click to copy"
      >
        {live === null ? (input.trim() ? "…" : "") : `= ${live}`}
        {copied && <span className="muted"> copied</span>}
      </button>
      <ul className="list">
        {history.map((h, i) => (
          <li key={i}>
            <button className="list-item" onClick={() => setInput(h.result)}>
              <span className="muted">{h.expr}</span>
              <span>{h.result}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
