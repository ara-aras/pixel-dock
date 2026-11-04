import { useMemo, useState } from "react";
import { CATEGORIES, convert, formatNumber, unitsOf } from "../lib/convert";
import type { AerieTabProps } from "./types";

const FIELD = "bg-white/10 text-white rounded px-2 py-1 outline-none";

export function ConvertTab({ accentColor }: AerieTabProps) {
  const [category, setCategory] = useState("Length");
  const units = unitsOf(category);
  const [from, setFrom] = useState(units[0]);
  const [to, setTo] = useState(units[1]);
  const [text, setText] = useState("1");

  const pick = (c: string) => {
    const u = unitsOf(c);
    setCategory(c);
    setFrom(u[0]);
    setTo(u[1]);
  };

  const result = useMemo(() => {
    const v = Number(text);
    if (text.trim() === "" || Number.isNaN(v)) return "";
    return formatNumber(convert(category, v, from, to));
  }, [category, text, from, to]);

  return (
    <div className="flex flex-col gap-1.5 p-1">
      <span className="text-white/85 text-[11px] uppercase tracking-wider">Converter</span>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Unit category">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={c === category}
            onClick={() => pick(c)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              c === category
                ? "bg-white/20 text-white"
                : "bg-white/8 text-white/60 hover:text-white hover:bg-white/12"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_96px] gap-1">
        <input
          autoFocus
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Value to convert"
          className={`${FIELD} text-[14px]`}
        />
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From unit"
          className={`${FIELD} text-[11px]`}
        >
          {units.map((u) => (
            <option key={u} value={u} className="bg-neutral-900">
              {u}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-[1fr_96px] gap-1">
        <output
          aria-live="polite"
          className="rounded border border-dashed border-white/20 px-2 py-1 text-[14px] font-medium truncate"
          style={{ color: result ? accentColor : "rgba(255,255,255,0.4)" }}
        >
          {result || "–"}
        </output>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To unit"
          className={`${FIELD} text-[11px]`}
        >
          {units.map((u) => (
            <option key={u} value={u} className="bg-neutral-900">
              {u}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
