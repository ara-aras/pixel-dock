//! Synthesized keyboard input (paste stack).
//!
//! Note: Windows blocks input from a normal-privilege app into an elevated
//! (administrator) window, so pasting into admin apps needs Aerie run as admin too.

/// Wait (up to 1.5 s) until Ctrl, Alt, Shift and Win are all released, then press Ctrl+V.
/// Hotkeys fire while modifiers are still held; pasting straight away would send
/// Ctrl+Alt+V instead of Ctrl+V.
#[cfg(target_os = "windows")]
pub fn send_paste_when_modifiers_released() {
    use std::time::{Duration, Instant};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    let held = |vk: VIRTUAL_KEY| unsafe { (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0 };
    let start = Instant::now();
    while [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN].iter().any(|k| held(*k)) {
        if start.elapsed() > Duration::from_millis(1500) {
            return; // user is still holding keys; do not paste something unexpected
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    // Give the clipboard owner change time to settle before the target app reads it.
    std::thread::sleep(Duration::from_millis(40));

    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let v = VIRTUAL_KEY(0x56); // 'V'
    let inputs = [key(VK_CONTROL, false), key(v, false), key(v, true), key(VK_CONTROL, true)];
    // SAFETY: inputs is a valid array of INPUT structs with the correct size.
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn send_paste_when_modifiers_released() {}
