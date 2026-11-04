import type { ComponentType } from "react";
import type { Settings } from "../settings";
import { CalcTab } from "./CalcTab";
import { ConvertTab } from "./ConvertTab";
import { HomeTab } from "./HomeTab";
import { NoteTab } from "./NoteTab";
import { SettingsTab } from "./SettingsTab";
import { SnippetsTab } from "./SnippetsTab";
import { TimerTab } from "./TimerTab";
import { TodoTab } from "./TodoTab";

export interface TabProps {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  monitorCount: number;
}

export interface TabDef {
  id: string;
  title: string;
  Component: ComponentType<TabProps>;
}

// Each tool registers itself here. Later phases add clipboard, shelf, voice memos, etc.
export const TABS: TabDef[] = [
  { id: "home", title: "Home", Component: HomeTab },
  { id: "todo", title: "To-do", Component: TodoTab },
  { id: "timer", title: "Timer", Component: TimerTab },
  { id: "note", title: "Note", Component: NoteTab },
  { id: "snippets", title: "Snippets", Component: SnippetsTab },
  { id: "calc", title: "Calc", Component: CalcTab },
  { id: "convert", title: "Convert", Component: ConvertTab },
  { id: "settings", title: "Settings", Component: SettingsTab },
];
