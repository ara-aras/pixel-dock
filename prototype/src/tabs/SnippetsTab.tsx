import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useState } from "react";
import { type Doc, docDelete, docPut, docsList, newId } from "../db";

interface Snippet {
  title: string;
  body: string;
}

const COLLECTION = "snippet";
const pad = (n: number) => String(n).padStart(2, "0");

/** Labels of the {?label} fill-in blanks in a snippet body, in order, without repeats. */
function fillLabels(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\?([^}]+)\}/g)].map((m) => m[1].trim()))];
}

/** Replace {date}, {time}, {clipboard} and {?label} placeholders. */
async function expand(body: string, fills: Record<string, string>): Promise<string> {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const clipboard = body.includes("{clipboard}") ? ((await readText().catch(() => "")) ?? "") : "";
  return body
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{clipboard\}/g, () => clipboard)
    .replace(/\{\?([^}]+)\}/g, (_, label: string) => fills[label.trim()] ?? "");
}

export function SnippetsTab() {
  const [items, setItems] = useState<Doc<Snippet>[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [filling, setFilling] = useState<{ snippet: Doc<Snippet>; values: Record<string, string> } | null>(null);
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    try {
      setItems(await docsList<Snippet>(COLLECTION));
    } catch {
      // Keep the current list.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 1500);
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) return;
    await docPut(COLLECTION, editing ?? newId(), { title: title.trim(), body });
    setTitle("");
    setBody("");
    setEditing(null);
    await refresh();
  };

  const copy = async (s: Doc<Snippet>, fills: Record<string, string>) => {
    await writeText(await expand(s.data.body, fills)).catch(() => {});
    setFilling(null);
    flash(`Copied "${s.data.title}"`);
  };

  const use = (s: Doc<Snippet>) => {
    const labels = fillLabels(s.data.body);
    if (labels.length === 0) void copy(s, {});
    else setFilling({ snippet: s, values: Object.fromEntries(labels.map((l) => [l, ""])) });
  };

  return (
    <div className="snippets">
      {filling ? (
        <div className="fill">
          <h3>{filling.snippet.data.title}</h3>
          {Object.keys(filling.values).map((label, i) => (
            <label key={label} className="fill-row">
              <span className="muted">{label}</span>
              <input
                className="field"
                autoFocus={i === 0}
                value={filling.values[label]}
                onChange={(e) =>
                  setFilling({ ...filling, values: { ...filling.values, [label]: e.target.value } })
                }
                onKeyDown={(e) => e.key === "Enter" && copy(filling.snippet, filling.values)}
              />
            </label>
          ))}
          <div className="timer-controls">
            <button className="btn primary" onClick={() => copy(filling.snippet, filling.values)}>
              Copy
            </button>
            <button className="btn" onClick={() => setFilling(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="list">
            {items.map((s) => (
              <li key={s.id} className="snippet-row">
                <button className="list-item" onClick={() => use(s)} title="Copy to clipboard">
                  <strong>{s.data.title}</strong>
                  <span className="muted clip">{s.data.body}</span>
                </button>
                <button
                  className="icon"
                  aria-label="Edit"
                  onClick={() => {
                    setEditing(s.id);
                    setTitle(s.data.title);
                    setBody(s.data.body);
                  }}
                >
                  ✎
                </button>
                <button
                  className="icon"
                  aria-label="Delete"
                  onClick={async () => {
                    await docDelete(COLLECTION, s.id);
                    await refresh();
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="muted">No snippets yet.</li>}
          </ul>
          <div className="snippet-form">
            <input
              className="field"
              value={title}
              placeholder="Title"
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="field"
              rows={3}
              value={body}
              placeholder="Text. Use {date}, {time}, {clipboard} or {?name} for a blank to fill in."
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="timer-controls">
              <button className="btn primary" onClick={save}>
                {editing ? "Save changes" : "Add snippet"}
              </button>
              {editing && (
                <button
                  className="btn"
                  onClick={() => {
                    setEditing(null);
                    setTitle("");
                    setBody("");
                  }}
                >
                  Cancel
                </button>
              )}
              <span className="muted">{status}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
