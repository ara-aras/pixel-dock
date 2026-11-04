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

/// The shortcut table. Ctrl+Alt+<key> are Aerie's; the Alt+Shift ones are the
/// mappings PILLAR reserved but never wired up (its function only logged them).
/// Teleprompter speed uses Ctrl+Alt+Shift+Up/Down because Ctrl+Alt+arrows rotate
/// the screen on many Intel graphics drivers.
fn hotkeys() -> Vec<(Shortcut, Hotkey)> {
    let ctrl_alt = Some(Modifiers::CONTROL | Modifiers::ALT);
    let ctrl_alt_shift = Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT);
    vec![
        (Shortcut::new(ctrl_alt, Code::KeyN), Hotkey::ToggleVisibility),
        (Shortcut::new(ctrl_alt, Code::KeyM), Hotkey::MicMute),
        (Shortcut::new(ctrl_alt, Code::KeyC), Hotkey::StackToggleCollect),
        (Shortcut::new(ctrl_alt, Code::KeyV), Hotkey::StackPasteNext),
        (Shortcut::new(ctrl_alt, Code::KeyR), Hotkey::Frontend(VOICE_EVENT, "toggle")),
        (Shortcut::new(ctrl_alt, Code::KeyP), Hotkey::Frontend(PROMPTER_EVENT, "toggle")),
        (Shortcut::new(ctrl_alt_shift, Code::ArrowUp), Hotkey::Frontend(PROMPTER_EVENT, "faster")),
        (Shortcut::new(ctrl_alt_shift, Code::ArrowDown), Hotkey::Frontend(PROMPTER_EVENT, "slower")),
        (
            Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Space),
            Hotkey::Action(WorkflowActionId::ToggleExpand),
        ),
        (
            Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyP),
            Hotkey::Action(WorkflowActionId::OpenProductivityTab),
        ),
        (
            Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyA),
            Hotkey::Action(WorkflowActionId::OpenPrismTab),
        ),
    ]
}

/// Plugin that dispatches the shortcut table. Registration happens in `register`.
pub fn global_shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let pressed = event.state() == ShortcutState::Pressed;
            for (candidate, hotkey) in hotkeys() {
                if &candidate != shortcut {
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

/// Register every shortcut. One taken by another app is logged and skipped, so the
/// rest (and the tray menu) keep working.
pub fn register(app: &AppHandle) {
    for (shortcut, _) in hotkeys() {
        if let Err(err) = app.global_shortcut().register(shortcut) {
            eprintln!("[AERIE] could not register shortcut {shortcut:?}: {err}");
        }
    }
}

/// One startup hook for everything Aerie adds, called from PILLAR's `setup`:
/// opens the database and starts background watchers.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = crate::aerie_db::data_dir();
    std::fs::create_dir_all(&dir)?;
    app.manage(crate::aerie_db::open(&dir.join("aerie.db"))?);
    app.manage(crate::aerie_phone::PhoneService::default());
    crate::aerie_clipboard::start_watcher(app.handle().clone());
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
        let keys: Vec<_> = super::hotkeys().into_iter().map(|(s, _)| s.to_string()).collect();
        let mut unique = keys.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(keys.len(), unique.len(), "duplicate shortcut in table: {keys:?}");
    }
}
