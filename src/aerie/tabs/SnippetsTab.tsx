import { useCallback, useEffect, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { type Doc, docDelete, docPut, docsList, newId, readClipboardText, writeClipboardText } from "../lib/store";
import { expandSnippet, fillLabels, type Snippet } from "../lib/snippets";
import { MaterialIcon } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

const COLLECTION = "snippet";
const FIELD = "bg-white/10 text-white text-[12px] rounded px-2 py-1 outline-none";

export function SnippetsTab({ accentColor }: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const [items, setItems] = useState<Doc<Snippet>[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [filling, setFilling] = useState<{ snippet: Doc<Snippet>; values: Record<string, string> } | null>(null);
  const [status, setStatus] = useState("");

  const refresh = useCallback(() => void docsList<Snippet>(COLLECTION).then(setItems).catch(() => {}), []);
  useEffect(refresh, [refresh]);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 1500);
  };

  const copy = async (s: Doc<Snippet>, fills: Record<string, string>) => {
    const clipboard = s.data.body.includes("{clipboard}") ? await readClipboardText() : "";
    await writeClipboardText(expandSnippet(s.data.body, { clipboard, fills }));
    setFilling(null);
    flash(`Copied "${s.data.title}"`);
  };

  const use = (s: Doc<Snippet>) => {
    const labels = fillLabels(s.data.body);
    if (labels.length === 0) fireAndForget(copy(s, {}), "copy snippet");
    else setFilling({ snippet: s, values: Object.fromEntries(labels.map((l) => [l, ""])) });
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) return;
    await docPut(COLLECTION, editing ?? newId(), { title: title.trim(), body });
    setTitle("");
    setBody("");
    setEditing(null);
    refresh();
  };

  const card = isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/8";

  if (filling) {
    return (
      <form
        className="flex flex-col gap-2 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          fireAndForget(copy(filling.snippet, filling.values), "copy snippet");
        }}
      >
        <span className="text-[12px] font-medium text-white">{filling.snippet.data.title}</span>
        {Object.keys(filling.values).map((label, i) => (
          <label key={label} className="flex flex-col gap-0.5 text-[11px] text-white/70">
            {label}
            <input
              autoFocus={i === 0}
              value={filling.values[label]}
              onChange={(e) => setFilling({ ...filling, values: { ...filling.values, [label]: e.target.value } })}
              className={FIELD}
            />
          </label>
        ))}
        <div className="flex gap-2">
          <button type="submit" className={`px-3 py-1 text-[11px] font-medium ${isMaterial ? "rounded-full bg-primary text-on-primary" : "rounded bg-white/20 text-white"}`}>
            Copy
          </button>
          <button type="button" onClick={() => setFilling(null)} className="px-2 py-1 text-[11px] text-white/70 hover:text-white">
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-1 min-h-0">
      <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
        {items.length === 0 && (
          <p className="py-2 text-center text-[11px] text-white/50">No snippets yet. Add one below.</p>
        )}
        {items.map((s) => (
          <div key={s.id} className={`group flex items-center gap-1 px-2 py-1 ${card}`}>
            <button type="button" onClick={() => use(s)} className="flex min-w-0 flex-1 flex-col text-left" aria-label={`Copy snippet ${s.data.title}`}>
              <span className="truncate text-[12px] font-medium text-white">{s.data.title}</span>
              <span className="truncate text-[10px] text-white/55">{s.data.body}</span>
            </button>
            <button
              type="button"
              aria-label={`Edit ${s.data.title}`}
              onClick={() => {
                setEditing(s.id);
                setTitle(s.data.title);
                setBody(s.data.body);
              }}
              className="rounded-full p-0.5 text-white/55 opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <MaterialIcon name="text_snippet" size={16} />
            </button>
            <button
              type="button"
              aria-label={`Delete ${s.data.title}`}
              onClick={() => fireAndForget(docDelete(COLLECTION, s.id).then(refresh), "delete snippet")}
              className="rounded-full p-0.5 text-white/55 opacity-0 hover:bg-white/10 hover:text-red-400 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <MaterialIcon name="delete" size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Snippet title" className={FIELD} />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Text. Use {date}, {time}, {clipboard} or {?name} for a blank."
          aria-label="Snippet text"
          className={`${FIELD} resize-none`}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fireAndForget(save(), "save snippet")}
            disabled={!title.trim() || !body.trim()}
            className={`px-3 py-1 text-[11px] font-medium disabled:opacity-40 ${isMaterial ? "rounded-full bg-primary text-on-primary" : "rounded bg-white/20 text-white"}`}
          >
            {editing ? "Save changes" : "Add snippet"}
          </button>
          {editing && (
            <button type="button" onClick={() => { setEditing(null); setTitle(""); setBody(""); }} className="text-[11px] text-white/60 hover:text-white">
              Cancel
            </button>
          )}
          <span className="ml-auto text-[10px]" style={{ color: accentColor }} aria-live="polite">
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
