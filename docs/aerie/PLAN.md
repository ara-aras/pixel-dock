# Phase Plan

Each phase ends with something usable. Do not start a phase until the previous exit criteria are met.

## Phase 0: Setup and reference study

- [x] Confirm Node, Rust (MSVC) and C++ build tools are installed. (Node 24, Rust 1.95 MSVC, WebView2 138, VS 2019 C++ tools.)
- [ ] Clone PILLAR into a scratch folder (read-only reference). Build and run it. (Skipped for now: shell was built directly. Revisit if overlay problems appear.)
- [ ] Note how PILLAR handles: transparent click-through window, hover hit-testing, multi-monitor, edge snapping.
- [ ] Record license notes for every reference repo in `docs/references.md`.
- [ ] Decide project name and fork-vs-rebuild (default: rebuild, port ideas only).

**Exit:** a reference notch runs locally and the overlay approach is understood.

## Phase 1: Overlay shell

- [x] Scaffold Tauri 2 + React + TS. (Plain CSS for now; Tailwind deferred until it is needed.)
- [x] One transparent always-on-top window. Design change: the window itself resizes between pill and panel and is pinned to the work-area edge, instead of a full-screen click-through window. Simpler and no hit-testing needed.
- [x] Pill with hover/click open, three panel sizes, top or bottom edge, tray icon to quit.
- [x] Move to another monitor via a Settings button (cycles monitors).
- [ ] Drag the pill to another edge or monitor.
- [x] Smooth open/close: Rust eases the window size over 170 ms; the panel is laid out at full size and clipped, so it reveals instead of reflowing.
- [x] Stay out of the way: click-to-open is the default (hover mode waits 350 ms), a slim idle line, and Ctrl+Alt+N or tray click hides and shows everything.
- [ ] Hide automatically during fullscreen apps. Start with Windows (toggle).
- [x] Tab dock framework: tabs register in `src/tabs/index.ts`.
- [ ] Settings: tab reorder and hide.
- [x] Strict CSP on the webview.

**Exit:** a notch that opens an empty tabbed panel and behaves well on multiple monitors.

## Phase 2: Storage and easy tools

- [ ] SQLite layer (`rusqlite`), migrations, `secure_delete` on, data folder under `%APPDATA%`.
- [ ] Note (autosave, Markdown preview).
- [ ] Calculator (plain-language math) and unit converter.
- [ ] To-do with natural-language dates (`chrono-node`) and reminders on the pill.
- [ ] Timer, stopwatch, Pomodoro with progress ring on the pill.
- [ ] Snippets with `{date}`, `{clipboard}` and fill-in placeholders.

**Exit:** daily-usable productivity panel. All data in one SQLite file.

## Phase 3: Clipboard family

- [ ] Clipboard history: text, links, images, files. Search, filter, pin, retention settings.
- [ ] Skip password managers and apps using Windows private-copy markers. Never-record list.
- [ ] Paste stack (copy several, paste in order) with global hotkeys.
- [ ] Shelf: temporary file holder, originals never touched, drag in and out.
- [ ] Cross-links: clip to snippet, stack, shelf, to-do.

**Exit:** clipboard tools are reliable and private. Verify with a password manager.

## Phase 4: Media, audio and calendar

- [ ] Mic mute (system-level default mic) with push-to-talk, live indicator on the pill.
- [ ] Camera mirror preview. Indicator when another app uses mic or camera.
- [ ] Voice memos (WebM/Opus), global start/stop shortcut, retention settings.
- [ ] Calendar: month grid, day view, reminders. No recurrence at first.
- [ ] Teleprompter: second window, speed and size controls, hide-from-capture option.

**Exit:** the full non-AI tool set from the reference product exists.

## Phase 5: Extras beyond the reference

Pick from, in order of value:

- [ ] Media controls (system media session) and album-art tint.
- [ ] Notification history, volume and device switcher, battery.
- [ ] CPU and RAM widget.
- [ ] Weather, recurring calendar events.
- [ ] Local AI chat: `llama-server` sidecar, model download with checksum and resume, localhost only.

**Exit:** a superset of the reference tool set.

## Phase 6: Cross-device (Apple-style ecosystem)

**Design first.** This is the one phase where a multi-agent design workflow (ultracode) is worth running: propose and judge sync and pairing architectures before writing code.

Decisions to make:

- [ ] Option A: run KDE Connect alongside and read from it (check what its Windows build exposes).
- [ ] Option B: implement the KDE Connect protocol in Rust so the existing Android app pairs with this app.
- [ ] Option C: own LAN link plus a phone web page.
- [ ] Licensing: confirm no GPL code is copied if distribution is ever considered.

First slice, whichever option wins:

- [ ] Manual pairing with confirmation and pinned per-device certificates. Never auto-accept LAN devices.
- [ ] Phone notifications on the pill.
- [ ] Clipboard sync.
- [ ] Send file to phone from the Shelf.

Later slices: battery, find-my-phone, SMS, media remote, phone as webcam, notes and reminders sync.

**Exit:** one phone pairs securely and syncs clipboard, notifications and files.

## Phase 7: Hardening and polish

- [ ] Code review focused on security (clipboard handling, pairing, CSP, SQL).
- [ ] Backup and restore of the SQLite file.
- [ ] Installer (NSIS or MSI), auto-start, update procedure.
- [ ] Accessibility: keyboard navigation, reduced motion.
- [ ] Performance: idle CPU and memory targets, startup time.

**Exit:** stable build for daily use.

## Working rules

- Normal mode (no ultracode) for scaffolding and simple tools.
- Higher effort or Opus for sync, pairing and security work.
- Use a multi-agent review workflow after Phase 3 and Phase 6.
- Update this file at the end of each phase: tick boxes, note decisions, record surprises.

## Decisions made

- Devices: one Windows laptop and a Pixel (Android) phone.
- Cross-device (Phase 6): aim to replicate KDE Connect-style features and integrate them better into the notch.
- Distribution: public GitHub repo, personal use first. Others may fork or clone at their own risk (see the disclaimer in README).
- Rebuild, not fork, PILLAR. Use it as a reference only.
- Overlay approach: one small window that resizes and re-pins itself, not a full-screen click-through window.

## Open questions

1. Final project name ("Aerie" is a working title).
2. Repo license (MIT fits "use at your own risk", but GPL care is needed if any KDE Connect code is ever copied).
3. Phone link option (A, B or C), decided in Phase 6.

---

## Pivot: fork PILLAR (decided 2026-11-04)

The repo root is now a fork of [PILLAR](https://github.com/warpirate/pillar-dynamic-island-for-windows) (MIT). Git remote `upstream` points at it; our work lives on the `aerie` branch. The earlier from-scratch shell and Phase 2 tools are kept in `prototype/` as a source to port from, not as the base.

**Why:** PILLAR already has what Phase 1, 4 and 5 planned (overlay with hover/click, tray, fullscreen hiding, autostart, settings, media controls via SMTC, notifications, per-app volume mixer, brightness, battery, CPU/RAM, Pomodoro with stats, tasks/notes/agenda, accessibility).

**What PILLAR lacks, so we add it:**

- Calculator, unit converter, snippets (ported from `prototype/`)
- Natural-language dates for tasks ("call mom tomorrow 5pm")
- Clipboard history, paste stack, shelf (Phase 3, new)
- Mic mute, camera mirror, voice memos, teleprompter (Phase 4, new)
- Real global shortcuts (PILLAR's `register_global_shortcuts` is a no-op stub)
- Cross-device phone link (Phase 6, new)

**Things to know about the PILLAR code:**

- `src/components/Pill/Pill.tsx` is a 1660-line monolith with a hard-coded tab switch. Adding a tab means editing `ExpandedTab`, `EXPANDED_TAB_CONFIG`, the render block, `visible_tabs` in `src/hooks/useSettings.ts` and `useAppearance.ts`, the Rust `LayoutVisibleTabsData` struct, and `VolumeModule.tsx`.
- `src-tauri/src/lib.rs` is about 3000 lines. New Rust features go in new modules (like the existing `sync/` and `workflows/`), not in `lib.rs`.
- Stack differs from the prototype: React 18, Tailwind, Motion, Rust edition 2021, Windows crate 0.58. Productivity data uses localStorage today; SQLite arrives with the clipboard work.
- Prism AI uses the Groq cloud API (needs `GROQ_API_KEY`). The on-device AI plan (llama.cpp sidecar) stays in Phase 5.
- Keep upstream mergeable: prefer new files and small hook-in edits over rewriting PILLAR files.

**Done: tab registry (step 1).** Aerie tabs are registered in `src/aerie/tabs/index.ts` (`AERIE_TABS`). One entry gives the tab its place in the strip, keyboard navigation, screen-reader announcement, panel wrapper and Layout toggle. PILLAR's six tabs are untouched. Settings now store tab visibility as a map (`visible_tabs: Record<string, boolean>`; Rust `HashMap<String, bool>`), and a tab missing from the map counts as visible, so old settings files keep working. Files touched in PILLAR: `Pill.tsx` (imports, visibility filter, announcement names, one render loop), `VolumeModule.tsx` (Layout toggles), `useSettings.ts` (type), `lib.rs` (struct to map). New files: `src/components/Pill/tabConfig.ts`, `src/aerie/tabs/*`. A placeholder "Aerie" tab proves it works and gets replaced by real tools.

**Done: calculator and converter ported (step 2, partly).** Logic is in `src/aerie/lib/calc.ts` and `convert.ts` (no React or Tauri imports); tabs are `CalcTab.tsx` and `ConvertTab.tsx`, styled with PILLAR's Tailwind conventions. Calculator history uses localStorage until the SQLite store lands. Tested with `npm run test:aerie` (21 checks: percent-of, units, word operators, temperature, data sizes, and that `evaluate`, `import`, `createUnit` and `parse` are blocked). Snippets still to port; they need the clipboard plugin and SQLite.

**Tab strip:** now scrolls horizontally instead of squeezing labels, and keeps the active tab in view.

**Known cost:** mathjs makes the frontend bundle about 1.08 MB (322 KB gzipped). Fine for a local app. If startup feels slow, lazy-load `CalcTab` with `React.lazy` and a `Suspense` wrapper in `Pill.tsx`.

**Done: staying out of the way.** New Rust module `src-tauri/src/aerie.rs`:

- **Ctrl+Alt+N** hides or shows the whole overlay (the window is hidden, so it cannot catch clicks). Also in the tray menu ("Show / hide") and as a "Hide now" button in the Aerie tab. The pill collapses before hiding via the `aerie://visibility` event.
- **Real global shortcuts.** PILLAR reserved Alt+Shift+Space (toggle panel), Alt+Shift+P (Focus tab) and Alt+Shift+A (Prism) but its function only logged them. They are now registered and routed through PILLAR's existing workflow actions. A combination owned by another app is logged and skipped, not fatal.
- **Open on hover: on/off.** Off means no hover "peek"; a click on the idle pill expands it directly (`usePillState` takes a `hoverPeekRef`).
- **Idle look: Pill or Slim line.** Slim is a 72x6 strip and the window shrinks with it, so the transparent area stops covering other apps. Hover and expanded sizes are unchanged.
- **Settings.** `AppSettings` has a free-form `aerie` JSON object (Rust `serde_json::Value`, always an object), so new Aerie options need no Rust change. Unknown keys survive load and save.
- **Tests.** `cargo test --lib aerie` (4 tests: old settings file loads, aerie bag and tab visibility round-trip, defaults serialize as objects, shortcut table has no duplicates).

**Verified on the running app:** all four shortcuts register without errors; Ctrl+Alt+N hid the window and showed it again at the same position. **Not verified:** the Aerie settings tab on screen, slim idle, and hover-off, which need a person to click through.

**Revised order:** (1) ~~refactor tab registration so new tabs are one line~~, (2) port calculator, converter, snippets, (3) SQLite store, (4) clipboard family, (5) real global shortcuts, mic mute, voice memos, teleprompter, (6) cross-device phone link.
