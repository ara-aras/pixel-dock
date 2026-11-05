//! WebView2 tweaks for Aerie's own pages.
//!
//! Voice memos and the camera mirror call getUserMedia. Inside WebView2 that pops a
//! browser-style "Allow microphone?" dialog over the notch, which is out of place
//! in a desktop app and blocks the hotkey recorder until answered. We answer it
//! ourselves, but only for Aerie's own origin and only for the microphone and
//! camera. Any other page or permission keeps WebView2's default behaviour.

/// True for the origins Aerie's UI is served from (dev server or the bundled app).
pub fn is_app_origin(uri: &str) -> bool {
    const ORIGINS: [&str; 4] = [
        "http://localhost:1420/",
        "http://tauri.localhost/",
        "https://tauri.localhost/",
        "tauri://localhost/",
    ];
    ORIGINS.iter().any(|o| uri.starts_with(o) || uri == o.trim_end_matches('/'))
}

#[cfg(target_os = "windows")]
pub fn allow_own_media(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    let result = window.with_webview(|wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else {
            eprintln!("[AERIE] webview: no CoreWebView2, media prompts stay on");
            return;
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            let mut uri = windows_core::PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = webview2_com::take_pwstr(uri);
            let media = kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA;
            if media && is_app_origin(&uri) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = Default::default();
        if let Err(e) = core.add_PermissionRequested(&handler, &mut token) {
            eprintln!("[AERIE] webview: could not hook permission requests: {e}");
        }
    });
    if let Err(e) = result {
        eprintln!("[AERIE] webview: {e}");
    }
}

#[cfg(not(target_os = "windows"))]
pub fn allow_own_media(_window: &tauri::WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::is_app_origin;

    #[test]
    fn only_aerie_origins_get_media() {
        assert!(is_app_origin("http://localhost:1420/"));
        assert!(is_app_origin("http://localhost:1420/index.html#prompter/1"));
        assert!(is_app_origin("http://tauri.localhost/"));
        assert!(is_app_origin("http://tauri.localhost"));
        assert!(!is_app_origin("http://localhost:14200/"), "port prefix must not match");
        assert!(!is_app_origin("http://localhost:1420.evil.example/"));
        assert!(!is_app_origin("https://example.com/"));
        assert!(!is_app_origin("http://tauri.localhost.evil.example/"));
    }
}
