import { useCallback, useEffect, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { useAerieEvent } from "../hooks/useAerieEvent";
import { useHotkeys } from "../hooks/useHotkeys";
import { clearStack, getStack, removeFromStack, setCollecting, type StackState } from "../lib/pasteStack";
import { MaterialIcon } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";

/** Paste stack: collect several copies, then paste them in order with Ctrl+Alt+V. */
export function StackPanel() {
  const { isMaterial } = useAerieThemeContext();
  const [stack, setStack] = useState<StackState>({ collecting: false, items: [] });
  const keys = useHotkeys();
  const load = useCallback(() => void getStack().then(setStack), []);

  useEffect(load, [load]);
  useAerieEvent("aerie://stack-changed", load);

  const card = isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/8";

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`flex items-center justify-between gap-2 px-2 py-1.5 ${card}`}>
        <div className="flex flex-col">
          <span className="text-[12px] text-white">Collect copies</span>
          <span className="text-[10px] text-white/55">Every copy joins the stack{keys.label("stack_collect") ? ` · ${keys.label("stack_collect")}` : ""}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={stack.collecting}
          aria-label="Collect copies into the stack"
          onClick={() => fireAndForget(setCollecting(!stack.collecting), "toggle collecting")}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            stack.collecting ? (isMaterial ? "bg-primary" : "bg-pill-accent") : "bg-white/20"
          }`}
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full transition-all ${
              stack.collecting ? `left-6 ${isMaterial ? "bg-on-primary" : "bg-fixed-white"}` : "left-1 bg-white/70"
            }`}
          />
        </button>
      </div>

      <p className="px-1 text-[10px] text-white/55">
        {keys.label("stack_paste") ?? "The paste shortcut"} pastes the next item into the app you are in, then moves on.
      </p>

      {stack.items.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-white/50">
          The stack is empty. Turn on collecting, or add items from History.
        </p>
      ) : (
        <ol className="flex flex-col gap-1" aria-label="Paste stack, in paste order">
          {stack.items.map((item, i) => (
            <li key={`${item.id}-${i}`} className={`flex items-center gap-2 px-2 py-1 ${card}`}>
              <span className="w-4 text-center text-[11px] font-medium text-white/60">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-white/90">
                {item.kind === "files" ? item.preview.split("\n").map((p) => p.split(/[\\/]/).pop()).join(", ") : item.preview}
              </span>
              <button
                type="button"
                onClick={() => fireAndForget(removeFromStack(i), "remove stack item")}
                aria-label={`Remove item ${i + 1}`}
                className="rounded-full p-0.5 text-white/55 hover:bg-white/10 hover:text-white"
              >
                <MaterialIcon name="close" size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}

      {stack.items.length > 0 && (
        <button
          type="button"
          onClick={() => fireAndForget(clearStack(), "clear stack")}
          className="self-end text-[10px] text-white/55 hover:text-white"
        >
          Clear stack
        </button>
      )}
      <p className="px-1 text-[10px] text-white/40">
        Pasting into apps running as administrator needs Aerie to run as administrator too.
      </p>
    </div>
  );
}
