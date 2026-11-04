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

/** Turn plain-language input into something mathjs understands. */
export function normalize(input: string): string {
  return input
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
    return math.format(result, { precision: 12 });
  } catch {
    return null;
  }
}
