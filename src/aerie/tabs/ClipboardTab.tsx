import { useCallback, useEffect, useMemo, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import { useAerieEvent } from "../hooks/useAerieEvent";
import { docPut, kvGet, kvGetJson, kvSet, kvSetJson, newId } from "../lib/store";
import { pushToStack } from "../lib/pasteStack";
import { StackPanel } from "./StackPanel";
import { dayGroup, relativeTime } from "../lib/time";
import { MaterialIcon, type MaterialIconName } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

interface Clip {
  id: number;
  kind: "text" | "link" | "image" | "files";
  preview: string | null;
  length: number;
  image_file: string | null;
  source_app: string | null;
  pinned: boolean;
  created: number;
  last_used: number;
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: "", label: "All" },
  { id: "text", label: "Text" },
  { id: "link", label: "Links" },
  { id: "image", label: "Images" },
  { id: "files", label: "Files" },
];

const KIND_ICON: Record<Clip["kind"], MaterialIconName> = {
  text: "description",
  link: "link",
  image: "image",
  files: "folder_open",
};

const DAYS = [7, 30, 90, 365, 0];
const SIZES = [100, 250, 500, 1000, 2500];

/** Thumbnail for an image clip, loaded on demand (images are stored as files, not in the list). */
function ClipImage({ id }: { id: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    tauriInvoke<string>("aerie_clip_image", { id }, { silent: true })
      .then((url) => live && setSrc(url))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return src ? (
    <img src={src} alt="Copied image" className="max-h-16 max-w-full rounded-md object-contain" />
  ) : (
    <span className="text-[11px] text-white/50">Image</span>
  );
}

function PrivacyPanel({ onClose }: { onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const [days, setDays] = useState(30);
  const [size, setSize] = useState(500);
  const [never, setNever] = useState("");

  useEffect(() => {
    void (async () => {
      setPaused((await kvGet("clip.paused")) === "1");
      setDays(Number((await kvGet("clip.max_days")) ?? 30));
      setSize(Number((await kvGet("clip.max_items")) ?? 500));
      setNever((await kvGetJson<string[]>("clip.never_record", [])).join(", "));
    })();
  }, []);

  const saveNever = () =>
    fireAndForget(
      kvSetJson(
        "clip.never_record",
        never
          .split(/[,\n]/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .map((s) => (s.endsWith(".exe") ? s : `${s}.exe`)),
      ),
      "save never-record list",
    );

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-white/5 p-2 text-[11px] text-white/85">
      <div className="flex items-center justify-between">
        <span className="font-medium uppercase tracking-wider text-[10px] text-white/70">History settings</span>
        <button type="button" onClick={onClose} aria-label="Close settings" className="text-white/60 hover:text-white">
          <MaterialIcon name="close" size={16} />
        </button>
      </div>
      <label className="flex items-center justify-between gap-2">
        Pause recording
        <input
          type="checkbox"
          checked={paused}
          onChange={(e) => {
            setPaused(e.target.checked);
            fireAndForget(kvSet("clip.paused", e.target.checked ? "1" : "0"), "pause clips");
          }}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        Keep for
        <select
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            fireAndForget(kvSet("clip.max_days", e.target.value), "clip days");
          }}
          className="rounded bg-white/10 px-1 py-0.5"
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "Forever" : d === 365 ? "1 year" : `${d} days`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        History size
        <select
          value={size}
          onChange={(e) => {
            setSize(Number(e.target.value));
            fireAndForget(kvSet("clip.max_items", e.target.value), "clip size");
          }}
          className="rounded bg-white/10 px-1 py-0.5"
        >
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s} clips
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Never record copies from (app names)
        <input
          value={never}
          onChange={(e) => setNever(e.target.value)}
          onBlur={saveNever}
          placeholder="e.g. notepad, slack"
          className="rounded bg-white/10 px-2 py-1 outline-none"
        />
      </label>
      <span className="text-[10px] text-white/50">
        Password managers (KeePass, Bitwarden, 1Password, …) and copies apps mark private are never recorded.
        Pinned clips are kept regardless of these limits.
      </span>
    </div>
  );
}

/** Clipboard tab: History (searchable, pinnable) and the paste Stack. */
export function ClipboardTab(props: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const [view, setView] = useState<"history" | "stack">("history");
  const seg = (on: boolean) =>
    isMaterial
      ? on
        ? "rounded-full bg-secondary-container text-on-secondary-container"
        : "rounded-full text-on-surface-variant hover:bg-on-surface/[0.08]"
      : on
        ? "rounded bg-white/20 text-white"
        : "rounded text-white/60 hover:text-white";
  return (
    <div className="flex flex-col gap-1.5 min-h-0">
      <div className={`flex gap-1 self-start p-0.5 ${isMaterial ? "rounded-full bg-surface-container-high" : ""}`} role="tablist" aria-label="Clipboard view">
        {(["history", "stack"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`flex items-center gap-1 px-2.5 py-0.5 text-[11px] transition-colors ${seg(view === v)}`}
          >
            <MaterialIcon name={v === "history" ? "content_paste" : "stacks"} size={14} filled={view === v} />
            {v === "history" ? "History" : "Stack"}
          </button>
        ))}
      </div>
      {view === "history" ? <HistoryView {...props} /> : <StackPanel />}
    </div>
  );
}

function HistoryView({ accentColor }: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const [clips, setClips] = useState<Clip[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await tauriInvoke<Clip[]>("aerie_clips_list", { query, kind, limit: 300 }, { silent: true });
      setClips(rows ?? []);
    } catch {
      // keep the current list
    }
  }, [query, kind]);

  useEffect(() => {
    const id = window.setTimeout(load, 120); // debounce typing
    return () => window.clearTimeout(id);
  }, [load]);

  useAerieEvent("aerie://clips-changed", () => void load());

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 1400);
  };

  const run = (cmd: string, args: Record<string, unknown>, msg?: string) =>
    tauriInvoke(cmd, args)
      .then(() => msg && flash(msg))
      .catch(() => flash("Could not do that"));

  const saveAsSnippet = async (clip: Clip) => {
    const text = await tauriInvoke<string>("aerie_clip_text", { id: clip.id });
    if (!text) return;
    const title = text.split("\n")[0].slice(0, 40) || "Snippet";
    await docPut("snippet", newId(), { title, body: text });
    flash("Saved as snippet");
  };

  const grouped = useMemo(() => {
    const groups: Array<{ label: string; items: Clip[] }> = [];
    const push = (label: string, c: Clip) => {
      const g = groups.find((x) => x.label === label);
      if (g) g.items.push(c);
      else groups.push({ label, items: [c] });
    };
    for (const c of clips) push(c.pinned ? "Pinned" : dayGroup(c.last_used), c);
    return groups;
  }, [clips]);

  const chip = (on: boolean) =>
    isMaterial
      ? on
        ? "rounded-full bg-secondary-container text-on-secondary-container"
        : "rounded-full text-on-surface-variant hover:bg-on-surface/[0.08]"
      : on
        ? "rounded bg-white/20 text-white"
        : "rounded text-white/60 hover:text-white";

  return (
    <div className="flex flex-col gap-1.5 p-1 min-h-0">
      <div className="flex items-center gap-1">
        <label className={`flex flex-1 items-center gap-1 px-2 py-1 ${isMaterial ? "rounded-full bg-surface-container-highest" : "rounded bg-white/10"}`}>
          <MaterialIcon name="search" size={16} className="text-white/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clipboard"
            aria-label="Search clipboard history"
            className="w-full bg-transparent text-[12px] text-white outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          aria-label="Clipboard history settings"
          aria-expanded={showSettings}
          className="rounded-full p-1 text-white/70 hover:bg-white/10"
        >
          <MaterialIcon name="settings" size={18} />
        </button>
      </div>

      {showSettings && <PrivacyPanel onClose={() => setShowSettings(false)} />}

      <div className="flex gap-1" role="radiogroup" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.id || "all"}
            type="button"
            role="radio"
            aria-checked={kind === f.id}
            onClick={() => setKind(f.id)}
            className={`px-2 py-0.5 text-[10px] transition-colors ${chip(kind === f.id)}`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px]" style={{ color: accentColor }} aria-live="polite">
          {status}
        </span>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
        {clips.length === 0 && (
          <p className="py-4 text-center text-[11px] text-white/50">
            {query || kind ? "No matching clips." : "Copy something and it shows up here."}
          </p>
        )}
        {grouped.map((g) => (
          <section key={g.label} aria-label={g.label} className="flex flex-col gap-1">
            <h4 className="px-1 text-[10px] font-medium uppercase tracking-wider text-white/50">{g.label}</h4>
            {g.items.map((c) => (
              <div
                key={c.id}
                className={`group relative flex items-start gap-2 px-2 py-1.5 ${
                  isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/8"
                }`}
              >
                <button
                  type="button"
                  onClick={() => run("aerie_clip_copy", { id: c.id }, "Copied")}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  aria-label={`Copy ${c.kind}${c.preview ? `: ${c.preview.slice(0, 60)}` : ""}`}
                >
                  <MaterialIcon name={KIND_ICON[c.kind]} size={16} className="mt-0.5 text-white/60" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    {c.kind === "image" ? (
                      <ClipImage id={c.id} />
                    ) : c.kind === "files" ? (
                      <span className="truncate text-[12px] text-white/90">
                        {(c.preview ?? "").split("\n").map((p) => p.split(/[\\/]/).pop()).join(", ")}
                      </span>
                    ) : (
                      <span className="line-clamp-2 break-words text-[12px] text-white/90">{c.preview}</span>
                    )}
                    <span className="text-[10px] text-white/45">
                      {c.source_app ? `${c.source_app.replace(/\.exe$/i, "")} · ` : ""}
                      {relativeTime(c.last_used)}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {c.kind !== "image" && (
                    <button
                      type="button"
                      onClick={() => fireAndForget(pushToStack(c.id).then(() => flash("Added to stack")), "add to stack")}
                      aria-label="Add to paste stack"
                      title="Add to paste stack"
                      className="rounded-full p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      <MaterialIcon name="stacks" size={16} />
                    </button>
                  )}
                  {(c.kind === "text" || c.kind === "link") && (
                    <button
                      type="button"
                      onClick={() => fireAndForget(saveAsSnippet(c), "save snippet")}
                      aria-label="Save as snippet"
                      title="Save as snippet"
                      className="rounded-full p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      <MaterialIcon name="text_snippet" size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => run("aerie_clip_set_pinned", { id: c.id, pinned: !c.pinned })}
                    aria-label={c.pinned ? "Unpin" : "Pin"}
                    aria-pressed={c.pinned}
                    title={c.pinned ? "Unpin" : "Pin"}
                    className="rounded-full p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    <MaterialIcon name={c.pinned ? "keep_off" : "keep"} size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => run("aerie_clip_delete", { id: c.id }, "Deleted")}
                    aria-label="Delete clip"
                    title="Delete"
                    className="rounded-full p-0.5 text-white/60 hover:bg-white/10 hover:text-red-400"
                  >
                    <MaterialIcon name="delete" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      {clips.some((c) => !c.pinned) && (
        <ClearButton onConfirm={() => run("aerie_clips_clear", {}, "Cleared")} />
      )}
    </div>
  );
}

/** Two-step clear so a stray click cannot wipe the history. */
function ClearButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      className={`self-end text-[10px] ${armed ? "text-red-400" : "text-white/55 hover:text-white"}`}
    >
      {armed ? "Click again to clear unpinned" : "Clear unpinned"}
    </button>
  );
}
