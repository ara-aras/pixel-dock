import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useState } from "react";
import { fireAndForget } from "../../lib/fireAndForget";
import { tauriInvoke } from "../../lib/tauri";
import { kvGetJson, kvSetJson } from "../lib/store";
import { MaterialIcon } from "../theme/MaterialIcon";
import { useAerieThemeContext } from "../theme/ThemeContext";
import type { AerieTabProps } from "./types";

interface ShelfItem {
  path: string;
  added: number;
}

const KEY = "shelf.items";
const MAX_ITEMS = 100;
const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

/** Small PNG used as the drag image, drawn once (the drag plugin needs a PNG). */
let dragIcon: string | null = null;
function getDragIcon(count: number): string {
  if (dragIcon && count === 1) return dragIcon;
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#5b6bff";
    ctx.beginPath();
    ctx.roundRect(4, 4, 40, 40, 10);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(count > 1 ? String(count) : "⇩", 24, 25);
  }
  const url = c.toDataURL("image/png");
  if (count === 1) dragIcon = url;
  return url;
}

/**
 * A temporary holder for files: drop files on the panel, drag them out later.
 * Only paths are kept; originals are never copied, moved or deleted.
 */
export function ShelfTab({ accentColor }: AerieTabProps) {
  const { isMaterial } = useAerieThemeContext();
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [hovering, setHovering] = useState(false);
  const [status, setStatus] = useState("");

  const save = useCallback((next: ShelfItem[]) => {
    setItems(next);
    fireAndForget(kvSetJson(KEY, next), "save shelf");
  }, []);

  useEffect(() => {
    void kvGetJson<ShelfItem[]>(KEY, []).then(setItems);
  }, []);

  // Flag items whose original was moved or deleted since it was shelved.
  useEffect(() => {
    if (items.length === 0) return;
    void tauriInvoke<boolean[]>("aerie_paths_exist", { paths: items.map((i) => i.path) }, { silent: true })
      .then((exists) => exists && setMissing(new Set(items.filter((_, i) => !exists[i]).map((i) => i.path))))
      .catch(() => {});
  }, [items]);

  // Native file drops onto the window (the webview's HTML drag events do not carry paths).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setHovering(true);
        else if (e.payload.type === "leave") setHovering(false);
        else if (e.payload.type === "drop") {
          setHovering(false);
          const dropped = e.payload.paths;
          setItems((prev) => {
            const known = new Set(prev.map((i) => i.path));
            const added = dropped.filter((p) => !known.has(p)).map((path) => ({ path, added: Date.now() }));
            const next = [...added, ...prev].slice(0, MAX_ITEMS);
            fireAndForget(kvSetJson(KEY, next), "save shelf");
            return next;
          });
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 1500);
  };

  const dragOut = (paths: string[]) =>
    fireAndForget(startDrag({ item: paths, icon: getDragIcon(paths.length) }), "drag from shelf");

  const card = isMaterial ? "rounded-2xl bg-surface-container-high" : "rounded-lg bg-white/8";
  const present = items.filter((i) => !missing.has(i.path)).map((i) => i.path);

  return (
    <div className="flex flex-col gap-1.5 p-1 min-h-0">
      <div
        className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed px-3 py-3 text-center transition-colors ${
          isMaterial ? "rounded-2xl" : "rounded-lg"
        } ${hovering ? "border-primary bg-primary/10" : "border-white/20"}`}
        aria-live="polite"
      >
        <MaterialIcon name="inventory_2" size={22} className="text-white/70" />
        <span className="text-[11px] text-white/75">
          {hovering ? "Drop to shelve" : "Drop files here. Drag them out when you need them."}
        </span>
      </div>

      {items.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(e) => {
              if (e.button === 0 && present.length) dragOut(present);
            }}
            disabled={present.length === 0}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${
              isMaterial ? "rounded-full bg-primary text-on-primary" : "rounded bg-white/20 text-white"
            }`}
            title="Press and drag to move all files into another app"
          >
            <MaterialIcon name="folder_open" size={14} /> Drag all ({present.length})
          </button>
          <button
            type="button"
            onClick={() =>
              fireAndForget(
                tauriInvoke("aerie_clipboard_write_files", { paths: present }).then(() => flash("Copied as files")),
                "copy shelf",
              )
            }
            disabled={present.length === 0}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-40"
          >
            <MaterialIcon name="content_copy" size={14} /> Copy
          </button>
          <button type="button" onClick={() => save([])} className="ml-auto text-[10px] text-white/55 hover:text-white">
            Clear shelf
          </button>
        </div>
      )}

      <span className="text-[10px]" style={{ color: accentColor }} aria-live="polite">
        {status}
      </span>

      <ul className="flex flex-col gap-1 overflow-y-auto min-h-0" aria-label="Shelved files">
        {items.map((item) => {
          const gone = missing.has(item.path);
          return (
            <li key={item.path} className={`group flex items-center gap-2 px-2 py-1 ${card}`}>
              <button
                type="button"
                disabled={gone}
                onPointerDown={(e) => {
                  if (e.button === 0 && !gone) dragOut([item.path]);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                title={gone ? "The original was moved or deleted" : `${item.path}\nPress and drag into another app`}
                aria-label={`${fileName(item.path)}${gone ? ", missing" : ", drag to use"}`}
              >
                <MaterialIcon name="description" size={16} className="text-white/60" />
                <span className={`min-w-0 flex-1 truncate text-[12px] ${gone ? "text-white/40 line-through" : "text-white/90"}`}>
                  {fileName(item.path)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => save(items.filter((i) => i.path !== item.path))}
                aria-label={`Remove ${fileName(item.path)} from shelf`}
                className="rounded-full p-0.5 text-white/55 opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <MaterialIcon name="close" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-white/40">Removing an item only takes it off the shelf; your files are never touched.</p>
    </div>
  );
}
