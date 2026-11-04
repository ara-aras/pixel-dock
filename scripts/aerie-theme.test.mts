import { materialPalette, glassPalette, cssVariables, contrastRatio, parseHex, toHex, toTriplet, ROLES } from "../src/aerie/theme/palette.ts";
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => { if (!ok) fail++; console.log(ok ? "ok  " : "FAIL", label, detail); };

for (const seed of ["#6750A4", "#0B57D0", "#EB0028", "#1E8E3E", "#FFFFFF", "#000000"]) {
  for (const dark of [false, true]) {
    for (const style of ["tonal", "vibrant", "expressive"] as const) {
      const p = materialPalette(seed, dark, style);
      const missing = ROLES.filter((r) => typeof p[r] !== "number");
      const c1 = contrastRatio(p["on-surface"], p["surface-container"]);
      const c2 = contrastRatio(p["on-primary"], p.primary);
      const c3 = contrastRatio(p["on-secondary-container"], p["secondary-container"]);
      const ok = missing.length === 0 && c1 >= 4.5 && c2 >= 4.5 && c3 >= 4.5;
      if (!ok) check(`${seed} ${dark ? "dark" : "light"} ${style}`, false, `missing=${missing} c1=${c1.toFixed(1)} c2=${c2.toFixed(1)} c3=${c3.toFixed(1)}`);
    }
  }
}
check("all seeds x modes x styles: every role present, text contrast >= 4.5:1", fail === 0);

const dark = materialPalette("#0B57D0", true);
const light = materialPalette("#0B57D0", false);
check("dark surface is darker than light surface", (dark.surface & 0xff) < (light.surface & 0xff), `${toHex(dark.surface)} vs ${toHex(light.surface)}`);
check("primary is blue-ish for a blue seed", (light.primary & 0xff) > ((light.primary >> 16) & 0xff), toHex(light.primary));

const g = glassPalette("#EB0028");
check("glass keeps PILLAR white text", toHex(g["on-surface"]) === "#ffffff");
check("glass primary is the exact accent", toHex(g.primary) === "#eb0028");
check("glass surface is PILLAR grey", toTriplet(g.surface) === "20 20 22");

const vars = cssVariables(light);
check("css vars: one per role, rgb triplets", Object.keys(vars).length === ROLES.length && /^\d+ \d+ \d+$/.test(vars["--md-primary"]), vars["--md-primary"]);

check("parseHex short form", parseHex("#fff") !== null && toHex(parseHex("#fff")!) === "#ffffff");
check("parseHex rejects junk", parseHex("red") === null && parseHex("#12345") === null);
check("bad seed falls back instead of throwing", typeof materialPalette("nonsense", true).primary === "number");

console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
