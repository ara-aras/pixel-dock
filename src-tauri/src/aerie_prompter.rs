//! Teleprompter: a small always-on-top window just under the camera (top-centre),
//! optionally hidden from screen capture so people on a call or recording do not
//! see it. Hiding uses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, which
//! needs Windows 10 2004 or newer; a phone pointed at the screen still sees it.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "prompter";
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 190.0;
/// Below PILLAR's pill so the two do not overlap.
const TOP_GAP: f64 = 48.0;

#[cfg(target_os = "windows")]
fn set_capture_hidden(window: &tauri::WebviewWindow, hidden: bool) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // tauri's HWND comes from its own `windows` version; both wrap the same raw pointer.
    let hwnd = HWND(hwnd.0 as _);
    // SAFETY: hwnd is a live top-level window owned by this process.
    unsafe { SetWindowDisplayAffinity(hwnd, if hidden { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }) }
        .map_err(|e| format!("could not change capture visibility: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn set_capture_hidden(_window: &tauri::WebviewWindow, _hidden: bool) -> Result<(), String> {
    Ok(())
}

/// Open (or focus) the teleprompter window for a script.
#[tauri::command]
pub fn aerie_prompter_open(app: AppHandle, script_id: String, hide_from_capture: bool) -> Result<(), String> {
    if !script_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid script id".into());
    }
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.close();
    }
    let url = WebviewUrl::App(format!("index.html#prompter/{script_id}").into());
    let mut builder = WebviewWindowBuilder::new(&app, LABEL, url)
        .title("Teleprompter")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .focused(false);
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let width = monitor.size().width as f64 / scale;
        builder = builder.position((width - WIDTH) / 2.0, TOP_GAP);
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    if hide_from_capture {
        set_capture_hidden(&window, true)?;
    }
    Ok(())
}

#[tauri::command]
pub fn aerie_prompter_set_capture_hidden(app: AppHandle, hidden: bool) -> Result<(), String> {
    match app.get_webview_window(LABEL) {
        Some(w) => set_capture_hidden(&w, hidden),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn aerie_prompter_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}
