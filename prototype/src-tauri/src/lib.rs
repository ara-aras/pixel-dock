mod db;

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const ANIM_MS: f64 = 170.0;

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Edge {
    Top,
    Bottom,
}

#[derive(Default)]
struct NotchState {
    /// Bumped on every placement; a running animation stops when it sees a newer value.
    generation: Arc<AtomicU64>,
    /// User hid the notch (hotkey/tray). While true the window is never shown.
    hidden: Arc<AtomicBool>,
}

/// Number of connected monitors, so the UI can cycle through them.
#[tauri::command]
fn monitor_count(window: WebviewWindow) -> Result<usize, String> {
    window
        .available_monitors()
        .map(|m| m.len().max(1))
        .map_err(|e| e.to_string())
}

/// Resize the overlay window and pin it, horizontally centred, to the top or
/// bottom edge of the chosen monitor's work area (so it never covers the taskbar).
/// Sizes arrive in logical pixels and are scaled for the target monitor.
/// With `animate`, the window eases to the target instead of jumping.
#[tauri::command]
fn place_notch(
    window: WebviewWindow,
    state: tauri::State<NotchState>,
    width: f64,
    height: f64,
    edge: Edge,
    monitor_index: usize,
    animate: bool,
) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = if monitors.is_empty() {
        window
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("no monitor available")?
    } else {
        monitors[monitor_index % monitors.len()].clone()
    };

    let scale = monitor.scale_factor();
    let w = (width * scale).round() as i32;
    let h = (height * scale).round() as i32;
    let area = monitor.work_area();
    let x = area.position.x + (area.size.width as i32 - w) / 2;
    let y = match edge {
        Edge::Top => area.position.y,
        Edge::Bottom => area.position.y + area.size.height as i32 - h,
    };

    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let hidden = state.hidden.load(Ordering::SeqCst);
    let visible = window.is_visible().unwrap_or(false);

    if !animate || hidden || !visible {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        window
            .set_size(PhysicalSize::new(w as u32, h as u32))
            .map_err(|e| e.to_string())?;
        if !hidden {
            window.show().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    let start_pos = window.outer_position().map_err(|e| e.to_string())?;
    let start_size = window.outer_size().map_err(|e| e.to_string())?;
    let counter = state.generation.clone();

    std::thread::spawn(move || {
        let began = Instant::now();
        loop {
            if counter.load(Ordering::SeqCst) != generation {
                return; // superseded by a newer placement
            }
            let t = (began.elapsed().as_secs_f64() * 1000.0 / ANIM_MS).min(1.0);
            let eased = 1.0 - (1.0 - t).powi(3); // ease-out cubic
            let lerp = |a: i32, b: i32| (a as f64 + (b - a) as f64 * eased).round() as i32;

            let _ = window.set_position(PhysicalPosition::new(
                lerp(start_pos.x, x),
                lerp(start_pos.y, y),
            ));
            let _ = window.set_size(PhysicalSize::new(
                lerp(start_size.width as i32, w).max(1) as u32,
                lerp(start_size.height as i32, h).max(1) as u32,
            ));

            if t >= 1.0 {
                return;
            }
            std::thread::sleep(Duration::from_millis(8));
        }
    });
    Ok(())
}

/// Hide or show the whole notch. While hidden it cannot get in the way of other apps.
fn toggle_visibility(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<NotchState>();
    let now_hidden = !state.hidden.fetch_xor(true, Ordering::SeqCst);
    if now_hidden {
        let _ = window.hide();
    } else {
        let _ = window.show();
    }
    let _ = app.emit("notch-visibility", !now_hidden);
}

#[tauri::command]
fn toggle_notch(app: AppHandle) {
    toggle_visibility(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(NotchState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_visibility(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(db::open(&data_dir.join("aerie.db"))?);

            // Ctrl+Alt+N hides or shows the notch. If another app owns the combo,
            // carry on: the tray icon still works.
            let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
            if let Err(err) = app.global_shortcut().register(hotkey) {
                eprintln!("could not register Ctrl+Alt+N: {err}");
            }

            // The window has no taskbar entry or decorations, so the tray is the
            // always-available way to hide or quit.
            let toggle =
                MenuItem::with_id(app, "toggle", "Show / hide (Ctrl+Alt+N)", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Aerie", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Aerie")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_visibility(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_visibility(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            monitor_count,
            place_notch,
            toggle_notch,
            quit_app,
            db::kv_get,
            db::kv_set,
            db::docs_list,
            db::doc_put,
            db::doc_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
