import { all, create } from "mathjs";

// Pure calculator logic: no React or Tauri imports, so it can be tested in Node.

const math = create(all);
const evaluate = math.evaluate.bind(math);

// The expression parser can import code and define units. Input is typed by the user
// but may be pasted from anywhere, so switch those features off after grabbing evaluate.
const disabled = () => {
  throw new Error("disabled");
};
math.import(
  {
    import: disabled,
    createUnit: disabled,
    evaluate: disabled,
    parse: disabled,
    simplify: disabled,
    derivative: disabled,
  },
  { override: true },
);

const TEMP: Record<string, string> = { f: "degF", c: "degC", k: "K" };
const tempUnit = (letter: string) => TEMP[letter.toLowerCase()] ?? letter;

/**
 * Temperatures the way people type them ("100 f to c", "30°C in F", "300 kelvin to
 * celsius") -> mathjs units (degF, degC, K). A bare f/c/k is only read as a
 * temperature right before or after "to", so "5 c" or "2 k" elsewhere are untouched.
 */
function temperatures(input: string): string {
  return input
    .replace(/\bfahrenheit\b/gi, "degF")
    .replace(/\b(celsius|centigrade)\b/gi, "degC")
    .replace(/\bkelvin\b/gi, "K")
    .replace(/°\s*([fck])\b/gi, (_, l: string) => tempUnit(l))
    .replace(/(\d)\s*([fck])(?=\s+(?:to|in)\s)/gi, (_, d: string, l: string) => `${d} ${tempUnit(l)}`)
    .replace(/\b(to|in)\s+([fck])\s*$/i, (_, w: string, l: string) => `${w} ${tempUnit(l)}`);
}

/** Turn plain-language input into something mathjs understands. */
export function normalize(input: string): string {
  return temperatures(input)
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+(.+)/gi, "(($1)/100)*($2)")
    .replace(/\s+plus\s+/gi, " + ")
    .replace(/\s+minus\s+/gi, " - ")
    .replace(/\s+times\s+/gi, " * ")
    .replace(/\s+divided by\s+/gi, " / ")
    .replace(/\s+in\s+(?=[a-z°])/gi, " to ");
}

/** Evaluate `input`, or return null if it is empty or not a valid expression. */
export function calculate(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const result = evaluate(normalize(text));
    if (result === undefined || typeof result === "function") return null;
    return math.format(result, { precision: 12 }).replace(/\bdegC\b/g, "°C").replace(/\bdegF\b/g, "°F");
  } catch {
    return null;
  }
}
