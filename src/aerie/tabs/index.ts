import { AerieSettingsTab } from "./AerieSettingsTab";
import { CalcTab } from "./CalcTab";
import { ClipboardTab } from "./ClipboardTab";
import { ConvertTab } from "./ConvertTab";
import { MicTab } from "./MicTab";
import { PrompterTab } from "./PrompterTab";
import { ShelfTab } from "./ShelfTab";
import { SnippetsTab } from "./SnippetsTab";
import { VoiceTab } from "./VoiceTab";
import type { AerieTab } from "./types";

export type { AerieTab, AerieTabProps } from "./types";

/**
 * Aerie's additions to PILLAR. PILLAR's own tabs (timer, media, notifications,
 * settings, prism, productivity) stay in `Pill.tsx`; everything we add goes here
 * so upstream merges stay small. Any tab can be hidden in Settings > Layout.
 */
export const AERIE_TABS: AerieTab[] = [
  { id: "clipboard", label: "Clipboard", icon: "📋", symbol: "content_paste", ariaLabel: "Clipboard history and paste stack", Component: ClipboardTab },
  { id: "snippets", label: "Snippets", icon: "✂", symbol: "text_snippet", ariaLabel: "Snippets", Component: SnippetsTab },
  { id: "shelf", label: "Shelf", icon: "📥", symbol: "inventory_2", ariaLabel: "File shelf", Component: ShelfTab },
  { id: "mic", label: "Mic", icon: "🎙", symbol: "mic", ariaLabel: "Microphone mute and camera mirror", Component: MicTab },
  { id: "voice", label: "Voice", icon: "⏺", symbol: "graphic_eq", ariaLabel: "Voice memos", Component: VoiceTab },
  { id: "prompter", label: "Prompter", icon: "📜", symbol: "subtitles", ariaLabel: "Teleprompter", Component: PrompterTab },
  { id: "calc", label: "Calc", icon: "=", symbol: "calculate", ariaLabel: "Calculator", Component: CalcTab },
  { id: "convert", label: "Convert", icon: "⇄", symbol: "swap_horiz", ariaLabel: "Unit converter", Component: ConvertTab },
  { id: "aerie", label: "Aerie", icon: "✦", symbol: "palette", ariaLabel: "Aerie options", Component: AerieSettingsTab },
];
