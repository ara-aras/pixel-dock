import { useMemo, useState } from "react";

// Linear categories store a factor to the base unit. Temperature is handled separately.
const LINEAR: Record<string, Record<string, number>> = {
  Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  Mass: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125 },
  Volume: {
    L: 1,
    mL: 0.001,
    "gal (US)": 3.785411784,
    "qt (US)": 0.946352946,
    "cup (US)": 0.2365882365,
    "fl oz (US)": 0.0295735295625,
    tbsp: 0.01478676478125,
    tsp: 0.00492892159375,
  },
  Speed: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, kn: 1852 / 3600, "ft/s": 0.3048 },
  Data: { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824 },
};

const TEMPS = ["°C", "°F", "K"];
const CATEGORIES = [...Object.keys(LINEAR), "Temperature"];

function unitsOf(category: string): string[] {
  return category === "Temperature" ? TEMPS : Object.keys(LINEAR[category]);
}

function toCelsius(v: number, unit: string) {
  return unit === "°F" ? ((v - 32) * 5) / 9 : unit === "K" ? v - 273.15 : v;
}
function fromCelsius(c: number, unit: string) {
  return unit === "°F" ? (c * 9) / 5 + 32 : unit === "K" ? c + 273.15 : c;
}

export function convert(category: string, value: number, from: string, to: string): number {
  if (category === "Temperature") return fromCelsius(toCelsius(value, from), to);
  const table = LINEAR[category];
  return (value * table[from]) / table[to];
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-6) return n.toExponential(6);
  return String(Number(n.toPrecision(10)));
}

export function ConvertTab() {
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
    return fmt(convert(category, v, from, to));
  }, [category, text, from, to]);

  return (
    <div className="convert">
      <div className="seg wrap">
        {CATEGORIES.map((c) => (
          <button key={c} className={c === category ? "on" : ""} onClick={() => pick(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="convert-row">
        <input
          className="field big"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select className="field" value={from} onChange={(e) => setFrom(e.target.value)}>
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
      <div className="convert-row">
        <div className="field big result">{result || "–"}</div>
        <select className="field" value={to} onChange={(e) => setTo(e.target.value)}>
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
