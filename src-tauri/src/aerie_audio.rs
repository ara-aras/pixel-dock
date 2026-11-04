//! Microphone mute at the Windows level (every app hears silence), with push-to-talk.
//!
//! Hotkey (Ctrl+Alt+M): a quick tap toggles mute; holding it while muted talks
//! until release, then mutes again.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const MIC_CHANGED: &str = "aerie://mic";
/// Presses shorter than this are taps (toggle); longer are holds (push-to-talk).
const TAP_MAX: Duration = Duration::from_millis(350);

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct MicState {
    pub available: bool,
    pub muted: bool,
}

#[cfg(target_os = "windows")]
mod win {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eCapture, eCommunications, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// Default capture devices for both roles (often the same device).
    fn endpoints() -> Result<Vec<IAudioEndpointVolume>, String> {
        // SAFETY: standard COM activation; interfaces are released on drop.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let e: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            let mut seen = Vec::new();
            for role in [eCommunications, eConsole] {
                if let Ok(device) = e.GetDefaultAudioEndpoint(eCapture, role) {
                    let id = device.GetId().ok().map(|p| p.to_string().unwrap_or_default());
                    if seen.contains(&id) {
                        continue;
                    }
                    seen.push(id);
                    if let Ok(v) = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                        out.push(v);
                    }
                }
            }
            if out.is_empty() {
                Err("No microphone".into())
            } else {
                Ok(out)
            }
        }
    }

    pub fn muted() -> Result<bool, String> {
        let eps = endpoints()?;
        // SAFETY: valid interface from endpoints().
        unsafe { eps[0].GetMute().map(|b| b.as_bool()).map_err(|e| e.to_string()) }
    }

    pub fn set_muted(mute: bool) -> Result<(), String> {
        for ep in endpoints()? {
            // SAFETY: valid interface; null event-context GUID is allowed.
            unsafe { ep.SetMute(mute, std::ptr::null()).map_err(|e| e.to_string())? };
        }
        Ok(())
    }
}

pub fn state() -> MicState {
    #[cfg(target_os = "windows")]
    {
        match win::muted() {
            Ok(muted) => MicState { available: true, muted },
            Err(_) => MicState { available: false, muted: false },
        }
    }
    #[cfg(not(target_os = "windows"))]
    MicState { available: false, muted: false }
}

fn set(app: &AppHandle, mute: bool) -> Result<MicState, String> {
    #[cfg(target_os = "windows")]
    win::set_muted(mute)?;
    #[cfg(not(target_os = "windows"))]
    let _ = mute;
    let s = state();
    let _ = app.emit(MIC_CHANGED, s);
    Ok(s)
}

/// What a hotkey press/release should do, given how long it was held.
/// Returns Some(new muted value) or None for "leave as is". Pure, for tests.
pub fn ptt_decision(was_muted: bool, held: Duration, on_release: bool) -> Option<bool> {
    match (on_release, was_muted, held < TAP_MAX) {
        (false, true, _) => Some(false),    // press while muted: talk now
        (false, false, _) => None,          // press while live: decide on release
        (true, true, true) => None,         // tap while muted: stay unmuted (toggle)
        (true, true, false) => Some(true),  // held while muted: push-to-talk ends
        (true, false, true) => Some(true),  // tap while live: mute
        (true, false, false) => None,       // held while live: nothing
    }
}

static PRESS: Mutex<Option<(Instant, bool)>> = Mutex::new(None);

pub fn on_hotkey_pressed(app: &AppHandle) {
    let s = state();
    if !s.available {
        let _ = app.emit(MIC_CHANGED, s);
        return;
    }
    if let Ok(mut p) = PRESS.lock() {
        if p.is_some() {
            return; // key repeat
        }
        *p = Some((Instant::now(), s.muted));
    }
    if let Some(m) = ptt_decision(s.muted, Duration::ZERO, false) {
        let _ = set(app, m);
    }
}

pub fn on_hotkey_released(app: &AppHandle) {
    let Some((at, was_muted)) = PRESS.lock().ok().and_then(|mut p| p.take()) else { return };
    if let Some(m) = ptt_decision(was_muted, at.elapsed(), true) {
        let _ = set(app, m);
    }
}

#[tauri::command]
pub fn aerie_mic_state() -> MicState {
    state()
}

#[tauri::command]
pub fn aerie_mic_set_muted(app: AppHandle, muted: bool) -> Result<MicState, String> {
    set(&app, muted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tap_toggles_and_hold_is_push_to_talk() {
        let tap = Duration::from_millis(100);
        let hold = Duration::from_millis(900);
        // Muted: press unmutes at once; a tap leaves it unmuted, a hold re-mutes.
        assert_eq!(ptt_decision(true, Duration::ZERO, false), Some(false));
        assert_eq!(ptt_decision(true, tap, true), None);
        assert_eq!(ptt_decision(true, hold, true), Some(true));
        // Live: nothing on press; a tap mutes, a hold does nothing.
        assert_eq!(ptt_decision(false, Duration::ZERO, false), None);
        assert_eq!(ptt_decision(false, tap, true), Some(true));
        assert_eq!(ptt_decision(false, hold, true), None);
    }
}
