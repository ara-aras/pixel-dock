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
}

/// The shortcut table. Ctrl+Alt+N is ours; the Alt+Shift ones are the mappings
/// PILLAR reserved but never wired up (its function only logged them).
fn hotkeys() -> Vec<(Shortcut, Hotkey)> {
    vec![
        (
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN),
            Hotkey::ToggleVisibility,
        ),
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
            if event.state() != ShortcutState::Pressed {
                return;
            }
            for (candidate, hotkey) in hotkeys() {
                if &candidate != shortcut {
                    continue;
                }
                match hotkey {
                    Hotkey::ToggleVisibility => toggle_visibility(app),
                    Hotkey::Action(id) => workflows::emit_action(app, id, "shortcut", None),
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
