import { tauriInvoke } from "../../lib/tauri";

export interface StackItem {
  id: number;
  kind: string;
  preview: string;
}

export interface StackState {
  collecting: boolean;
  items: StackItem[];
}

export const getStack = async (): Promise<StackState> =>
  (await tauriInvoke<StackState>("aerie_stack_get", undefined, { silent: true })) ?? { collecting: false, items: [] };

export const pushToStack = (id: number) => tauriInvoke("aerie_stack_push", { id });
export const removeFromStack = (index: number) => tauriInvoke("aerie_stack_remove", { index });
export const clearStack = () => tauriInvoke("aerie_stack_clear");
export const setCollecting = (collecting: boolean) => tauriInvoke("aerie_stack_set_collecting", { collecting });
export const pasteNext = () => tauriInvoke("aerie_stack_paste_next");
