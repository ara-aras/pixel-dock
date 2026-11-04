import { AerieSettingsTab } from "./AerieSettingsTab";
import { CalcTab } from "./CalcTab";
import { ConvertTab } from "./ConvertTab";
import type { AerieTab } from "./types";

export type { AerieTab, AerieTabProps } from "./types";

/**
 * Aerie's additions to PILLAR. PILLAR's own tabs (timer, media, notifications,
 * settings, prism, productivity) stay in `Pill.tsx`; everything we add goes here
 * so upstream merges stay small.
 */
export const AERIE_TABS: AerieTab[] = [
  { id: "calc", label: "Calc", icon: "=", ariaLabel: "Calculator", Component: CalcTab },
  { id: "convert", label: "Convert", icon: "⇄", ariaLabel: "Unit converter", Component: ConvertTab },
  { id: "aerie", label: "Aerie", icon: "✦", ariaLabel: "Aerie options", Component: AerieSettingsTab },
];
