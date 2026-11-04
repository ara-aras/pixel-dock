import { useEffect, useRef, useState } from "react";
import { kvGet, kvSet } from "../db";
import { Markdown } from "../Markdown";

const KEY = "note";

export function NoteTab() {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(false);
  const latest = useRef("");
  const dirty = useRef(false);

  useEffect(() => {
    kvGet(KEY)
      .then((v) => {
        latest.current = v ?? "";
        setText(latest.current);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Debounced autosave while typing...
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const id = window.setTimeout(() => {
      dirty.current = false;
      kvSet(KEY, text).catch(() => {});
    }, 400);
    return () => window.clearTimeout(id);
  }, [text, loaded]);

  // ...and flush on unmount so closing the panel never loses the last keystrokes.
  useEffect(
    () => () => {
      if (dirty.current) kvSet(KEY, latest.current).catch(() => {});
    },
    [],
  );

  return (
    <div className="note">
      <div className="note-bar">
        <span className="muted">{text.length} chars · saves as you type</span>
        <button className="btn" onClick={() => setPreview((p) => !p)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="note-view">
          <Markdown source={text} />
        </div>
      ) : (
        <textarea
          className="note-area"
          value={text}
          placeholder="Quick note. Markdown works."
          spellCheck={false}
          onChange={(e) => {
            dirty.current = true;
            latest.current = e.target.value;
            setText(e.target.value);
          }}
        />
      )}
    </div>
  );
}
