# Aerie (working title)

A personal-use Windows desktop "notch": a small pill at the edge of the screen that opens into a panel of everyday tools. Long-term goal: an Apple-style cross-device ecosystem between a Windows PC and an Android phone.

Status: **Phase 1 in progress**. The overlay shell runs: a pill at the top-center of the screen that expands on hover into a tabbed panel. See [PLAN.md](PLAN.md) for the phased roadmap.

## Disclaimer

This is a personal hobby project, shared publicly as-is. It is provided without warranty of any kind. It reads your clipboard, microphone and files as features are added. Use it, fork it or clone it at your own risk, and review the code before running anything you do not trust.

## Run it

```bash
npm install
npm run tauri dev
```

Build an installer with `npm run tauri build`. Quit from the tray icon or the Settings tab.

## Goals

1. A notch overlay that stays out of the way: click-through everywhere except the pill and the open panel.
2. A set of local-first tools in one panel (clipboard, timer, to-do, notes, and more).
3. Later: PC and phone integration (clipboard, files, notifications) in the spirit of Apple Continuity.

## Non-goals

- Not a copy of any commercial app. Features are inspired by public descriptions only. No branding, assets or code are copied.
- No accounts, no telemetry, no cloud. Data stays on the user's machines.
- Not for sale or distribution (personal use). This keeps licensing and support simple. Revisit before any release.

## Planned stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | Tauri 2 (Rust) | WebView2 on Windows, global shortcuts, always-on-top transparent window |
| UI | React + TypeScript + Vite, plain CSS | Each tool is one tab component. Tailwind deferred |
| Storage | SQLite (single file) | `secure_delete` on, one file to back up |
| Secrets | Windows DPAPI | Only if secrets are ever needed |
| Local AI (late) | `llama-server` sidecar (llama.cpp) | Optional, on-device, localhost only |
| Phone link (late) | KDE Connect protocol, or own LAN link | Decision in Phase 6 |
| Android app | Existing KDE Connect app, or own app | Decision in Phase 6 |

## Reference projects

Read for ideas; check each license before copying any code.

- [PILLAR](https://github.com/warpirate/pillar-dynamic-island-for-windows): Tauri + React + Rust notch. MIT. Primary reference for overlay and media/system widgets.
- [WindyLand](https://github.com/shabab239/WindyLand): Rust notch with clipboard, shelf, timers.
- [Oyenza Studio](https://github.com/lucacadalora/poni): Rust notch with tasks, clipboard, shelf.
- [Notchy](https://github.com/Jeremyszs/Notchy): small Tauri 2 + Svelte 5 notch.
- KDE Connect: open protocol for PC and Android. Code is GPL. Reimplementing from the public protocol spec is fine; copying source makes this app GPL.

## Prerequisites (Windows 10 2004+ or Windows 11, x64)

- Node.js 18 or newer
- Rust (MSVC toolchain) and Visual Studio C++ Build Tools
- WebView2 runtime (included in Windows 11)

Verify:

```bash
node --version
rustc --version
```

## Repository layout (planned)

```
src/          React UI (components, hooks, lib)
src-tauri/    Rust backend (commands, storage, native integrations)
docs/         Design notes and decisions
PLAN.md       Phased roadmap
```

## Principles

- Local-first. One SQLite file holds all user data.
- Least privilege. Webview has a strict CSP and cannot reach the internet.
- Private by default. Clipboard history skips known password managers and apps that mark copies private.
- Small phases. Each phase ends with something usable.
