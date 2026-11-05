//! Aerie additions to PILLAR: hide/show the whole overlay and real global shortcuts.
//!
//! Kept in its own module so upstream merges of `lib.rs` stay small.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::workflows::{self, WorkflowActionId};

/// Event the frontend listens to so it can collapse the pill when the overlay hides.
const VISIBILITY_EVENT: &str = "aerie://visibility";

#[derive(Default)]
pub struct AerieState {
    /// True while the user has hidden the overlay (hotkey, tray or settings).
    hidden: AtomicBool,
}

enum Hotkey {
    ToggleVisibility,
    Action(WorkflowActionId),
    /// Mic mute: needs press and release (tap = toggle, hold = push-to-talk).
    MicMute,
    StackToggleCollect,
    StackPasteNext,
    /// Forwarded to the frontend as an event (voice recorder, teleprompter).
    Frontend(&'static str, &'static str),
}

/// Frontend event carrying a command string, e.g. ("aerie://voice", "toggle").
pub const VOICE_EVENT: &str = "aerie://voice";
pub const PROMPTER_EVENT: &str = "aerie://prompter";

/// One action with the key combinations to try, in order. The first one Windows
/// grants is used; the rest are fallbacks for when another app already owns it.
struct Binding {
    id: &'static str,
    what: &'static str,
    hotkey: Hotkey,
    keys: Vec<Shortcut>,
}

/// The shortcut table. Ctrl+Alt+<key> are Aerie's; the Alt+Shift ones are the
/// mappings PILLAR reserved but never wired up (its function only logged them).
/// Teleprompter speed uses Ctrl+Alt+Shift+Up/Down because Ctrl+Alt+arrows rotate
/// the screen on many Intel graphics drivers.
fn bindings() -> Vec<Binding> {
    let ctrl_alt = Some(Modifiers::CONTROL | Modifiers::ALT);
    let ctrl_alt_shift = Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT);
    let alt_shift = Some(Modifiers::ALT | Modifiers::SHIFT);
    let b = |id, what, hotkey, keys| Binding { id, what, hotkey, keys };
    vec![
        b("visibility", "Hide or show the whole overlay", Hotkey::ToggleVisibility, vec![Shortcut::new(ctrl_alt, Code::KeyN)]),
        b(
            "mic",
            "Mute or unmute the mic (hold to talk while muted)",
            Hotkey::MicMute,
            vec![
                Shortcut::new(ctrl_alt, Code::KeyM),
                Shortcut::new(ctrl_alt_shift, Code::KeyM),
                Shortcut::new(ctrl_alt, Code::KeyK),
                Shortcut::new(ctrl_alt, Code::KeyQ),
            ],
        ),
        b("stack_collect", "Paste stack: start or stop collecting", Hotkey::StackToggleCollect, vec![Shortcut::new(ctrl_alt, Code::KeyC)]),
        b("stack_paste", "Paste stack: paste the next item", Hotkey::StackPasteNext, vec![Shortcut::new(ctrl_alt, Code::KeyV)]),
        b(
            "voice",
            "Start or stop a voice memo",
            Hotkey::Frontend(VOICE_EVENT, "toggle"),
            vec![Shortcut::new(ctrl_alt, Code::KeyR), Shortcut::new(ctrl_alt_shift, Code::KeyR)],
        ),
        b("prompter", "Teleprompter: show, play or pause", Hotkey::Frontend(PROMPTER_EVENT, "toggle"), vec![Shortcut::new(ctrl_alt, Code::KeyP)]),
        b("prompter_faster", "Teleprompter: faster", Hotkey::Frontend(PROMPTER_EVENT, "faster"), vec![Shortcut::new(ctrl_alt_shift, Code::ArrowUp)]),
        b("prompter_slower", "Teleprompter: slower", Hotkey::Frontend(PROMPTER_EVENT, "slower"), vec![Shortcut::new(ctrl_alt_shift, Code::ArrowDown)]),
        b("panel", "Open or close the panel", Hotkey::Action(WorkflowActionId::ToggleExpand), vec![Shortcut::new(alt_shift, Code::Space)]),
        b("focus", "Open Focus (tasks, notes)", Hotkey::Action(WorkflowActionId::OpenProductivityTab), vec![Shortcut::new(alt_shift, Code::KeyP)]),
        b("prism", "Open Prism AI", Hotkey::Action(WorkflowActionId::OpenPrismTab), vec![Shortcut::new(alt_shift, Code::KeyA)]),
    ]
}

/// Which combination each binding actually got (id -> shortcut), filled by `register`.
static REGISTERED: std::sync::Mutex<Vec<(&'static str, Shortcut)>> = std::sync::Mutex::new(Vec::new());

/// "Ctrl+Alt+Shift+M" style label for the UI.
pub fn shortcut_label(s: &Shortcut) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (m, name) in [(Modifiers::CONTROL, "Ctrl"), (Modifiers::ALT, "Alt"), (Modifiers::SHIFT, "Shift"), (Modifiers::SUPER, "Win")] {
        if s.mods.contains(m) {
            parts.push(name.into());
        }
    }
    let key = format!("{:?}", s.key);
    parts.push(match s.key {
        Code::ArrowUp => "↑".into(),
        Code::ArrowDown => "↓".into(),
        _ => key.strip_prefix("Key").or_else(|| key.strip_prefix("Digit")).unwrap_or(&key).to_string(),
    });
    parts.join("+")
}

/// Plugin that dispatches the shortcut table. Registration happens in `register`.
pub fn global_shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let pressed = event.state() == ShortcutState::Pressed;
            for Binding { hotkey, keys, .. } in bindings() {
                if !keys.contains(shortcut) {
                    continue;
                }
                match (hotkey, pressed) {
                    (Hotkey::MicMute, true) => crate::aerie_audio::on_hotkey_pressed(app),
                    (Hotkey::MicMute, false) => crate::aerie_audio::on_hotkey_released(app),
                    (_, false) => {} // everything else acts on press only
                    (Hotkey::ToggleVisibility, true) => toggle_visibility(app),
                    (Hotkey::Action(id), true) => workflows::emit_action(app, id, "shortcut", None),
                    (Hotkey::StackToggleCollect, true) => crate::aerie_stack::toggle_collecting(app),
                    (Hotkey::StackPasteNext, true) => crate::aerie_stack::paste_next(app),
                    (Hotkey::Frontend(event_name, command), true) => {
                        let _ = app.emit(event_name, command);
                    }
                }
                break;
            }
        })
        .build()
}

/// Register every shortcut, falling back to the next combination when one is taken
/// by another app. A binding with none free is logged and skipped, so the rest
/// (and the tray menu) keep working.
pub fn register(app: &AppHandle) {
    let mut got = Vec::new();
    for Binding { id, keys, .. } in bindings() {
        let mut errors = Vec::new();
        let chosen = keys.into_iter().find(|k| match app.global_shortcut().register(*k) {
            Ok(()) => true,
            Err(err) => {
                errors.push(format!("{} ({err})", shortcut_label(k)));
                false
            }
        });
        match chosen {
            Some(k) => {
                if !errors.is_empty() {
                    eprintln!("[AERIE] {id}: using {} because {} is taken", shortcut_label(&k), errors.join(", "));
                }
                got.push((id, k));
            }
            None => eprintln!("[AERIE] {id}: no free shortcut: {}", errors.join(", ")),
        }
    }
    if let Ok(mut r) = REGISTERED.lock() {
        *r = got;
    }
}

#[derive(serde::Serialize)]
pub struct HotkeyInfo {
    id: &'static str,
    what: &'static str,
    /// The combination in use, or None when every option was taken.
    keys: Option<String>,
}

/// The shortcuts as actually registered, so the UI never shows one that does not work.
#[tauri::command]
pub fn aerie_hotkeys() -> Vec<HotkeyInfo> {
    let registered = REGISTERED.lock().map(|r| r.clone()).unwrap_or_default();
    bindings()
        .into_iter()
        .map(|b| HotkeyInfo {
            id: b.id,
            what: b.what,
            keys: registered.iter().find(|(id, _)| *id == b.id).map(|(_, k)| shortcut_label(k)),
        })
        .collect()
}

/// One startup hook for everything Aerie adds, called from PILLAR's `setup`:
/// opens the database and starts background watchers.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = crate::aerie_db::data_dir();
    std::fs::create_dir_all(&dir)?;
    app.manage(crate::aerie_db::open(&dir.join("aerie.db"))?);
    app.manage(crate::aerie_phone::PhoneService::default());
    crate::aerie_clipboard::start_watcher(app.handle().clone());
    // Voice memos / camera mirror: no browser-style permission popup for our own page.
    if let Some(main) = app.get_webview_window("main") {
        crate::aerie_webview::allow_own_media(&main);
    }
    // Phone link only starts if the user turned it on (it listens on the LAN).
    crate::aerie_phone::start_if_enabled(app.handle());
    Ok(())
}

/// Hide the overlay window if visible, show it if hidden.
pub fn toggle_visibility(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<AerieState>();
    let now_hidden = !state.hidden.fetch_xor(true, Ordering::SeqCst);
    let result = if now_hidden { window.hide() } else { window.show() };
    if let Err(err) = result {
        eprintln!("[AERIE] could not change window visibility: {err}");
    }
    let _ = app.emit(VISIBILITY_EVENT, !now_hidden);
}

#[tauri::command]
pub fn aerie_toggle_visibility(app: AppHandle) {
    toggle_visibility(&app);
}

#[tauri::command]
pub fn aerie_is_hidden(state: State<AerieState>) -> bool {
    state.hidden.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use crate::AppSettings;

    #[test]
    fn settings_file_without_aerie_loads_with_empty_object() {
        // Files written by upstream PILLAR (or older Aerie) have no "aerie" key.
        let s: AppSettings = serde_json::from_str(r#"{"appearance":{"mode":"island"}}"#).unwrap();
        let bag = s.aerie.as_object().expect("aerie must be a JSON object, never null");
        assert!(bag.is_empty());
    }

    #[test]
    fn aerie_bag_and_tab_visibility_round_trip() {
        let json = r#"{
            "layout": { "visible_tabs": { "timer": false, "calc": true, "future_tab": false } },
            "aerie": { "hover_peek": false, "idle_style": "slim", "unknown_future_option": 7 }
        }"#;
        let s: AppSettings = serde_json::from_str(json).unwrap();
        let back = serde_json::to_value(&s).unwrap();

        // Unknown keys survive a load and save, so newer frontends are not clobbered.
        assert_eq!(back["aerie"]["hover_peek"], false);
        assert_eq!(back["aerie"]["idle_style"], "slim");
        assert_eq!(back["aerie"]["unknown_future_option"], 7);
        assert_eq!(back["layout"]["visible_tabs"]["timer"], false);
        assert_eq!(back["layout"]["visible_tabs"]["calc"], true);
        assert_eq!(back["layout"]["visible_tabs"]["future_tab"], false);
    }

    #[test]
    fn default_settings_serialize_aerie_as_object() {
        let back = serde_json::to_value(AppSettings::default()).unwrap();
        assert!(back["aerie"].is_object());
        assert!(back["layout"]["visible_tabs"].is_object());
    }

    #[test]
    fn every_shortcut_is_distinct() {
        // Two entries on the same combination would make one of them unreachable.
        // Fallbacks count too: a fallback equal to another action's key would steal it.
        let keys: Vec<_> = super::bindings().into_iter().flat_map(|b| b.keys).map(|s| s.to_string()).collect();
        let mut unique = keys.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(keys.len(), unique.len(), "duplicate shortcut in table: {keys:?}");
    }

    #[test]
    fn shortcut_labels_read_like_windows() {
        use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
        let l = |m, c| super::shortcut_label(&Shortcut::new(Some(m), c));
        assert_eq!(l(Modifiers::CONTROL | Modifiers::ALT, Code::KeyM), "Ctrl+Alt+M");
        assert_eq!(l(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT, Code::ArrowUp), "Ctrl+Alt+Shift+↑");
        assert_eq!(l(Modifiers::ALT | Modifiers::SHIFT, Code::Space), "Alt+Shift+Space");
    }
}
