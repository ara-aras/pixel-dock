//! Colour sources for Aerie's Material theme: the desktop wallpaper (Pixel-style
//! "colours from wallpaper") and the Windows accent colour.
//!
//! The frontend does the colour science (Material Color Utilities); Rust only
//! hands over the raw inputs it cannot reach from the webview.

use serde::Serialize;

/// Wallpapers bigger than this are skipped rather than base64-encoded into IPC.
const MAX_WALLPAPER_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct WallpaperInfo {
    pub path: String,
    /// Last-modified time in ms since the Unix epoch, so the UI can tell when to re-read.
    pub modified_ms: u64,
    pub size: u64,
}

/// Image MIME type from the file's first bytes. Windows stores some wallpapers
/// (e.g. `TranscodedWallpaper`) without an extension, so the name is no help.
pub fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [b'B', b'M', ..] => Some("image/bmp"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

/// `AccentColor` in the registry is a DWORD laid out as 0xAABBGGRR.
pub fn accent_dword_to_hex(value: u32) -> String {
    let r = value & 0xFF;
    let g = (value >> 8) & 0xFF;
    let b = (value >> 16) & 0xFF;
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn wallpaper_info_for(path: &str) -> Option<WallpaperInfo> {
    if path.is_empty() {
        return None; // solid-colour background: no image
    }
    let meta = std::fs::metadata(path).ok()?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(WallpaperInfo { path: path.to_string(), modified_ms, size: meta.len() })
}

#[cfg(target_os = "windows")]
fn wallpaper_path() -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };
    let mut buf = [0u16; 1024];
    // SAFETY: buf outlives the call and its length in u16s is passed as uiParam.
    unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr().cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .ok()?;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

#[cfg(not(target_os = "windows"))]
fn wallpaper_path() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn accent_dword() -> Option<u32> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: value and size are valid for writes for the duration of the call.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\DWM"),
            w!("AccentColor"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    status.is_ok().then_some(value)
}

#[cfg(not(target_os = "windows"))]
fn accent_dword() -> Option<u32> {
    None
}

/// Where the current wallpaper lives and when it last changed. Cheap: poll this,
/// and only fetch the image when it differs.
#[tauri::command]
pub fn aerie_wallpaper_info() -> Option<WallpaperInfo> {
    wallpaper_info_for(&wallpaper_path()?)
}

/// The current wallpaper as a `data:` URL (the webview cannot read local files).
/// None when there is no image wallpaper, it is too large, or it is not an image.
#[tauri::command]
pub fn aerie_wallpaper_image() -> Option<String> {
    use base64::Engine;
    let info = aerie_wallpaper_info()?;
    if info.size > MAX_WALLPAPER_BYTES {
        return None;
    }
    let bytes = std::fs::read(&info.path).ok()?;
    let mime = sniff_image_mime(&bytes)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

/// The Windows accent colour as `#rrggbb`, if set.
#[tauri::command]
pub fn aerie_windows_accent() -> Option<String> {
    accent_dword().map(accent_dword_to_hex)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_dword_is_abgr() {
        // 0xAABBGGRR: alpha ff, blue 0x78, green 0xd4, red 0x00 -> #00d478
        assert_eq!(accent_dword_to_hex(0xff78d400), "#00d478");
        assert_eq!(accent_dword_to_hex(0x000000ff), "#ff0000");
        assert_eq!(accent_dword_to_hex(0x00ff0000), "#0000ff");
    }

    #[test]
    fn sniffs_common_wallpaper_formats() {
        assert_eq!(sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff_image_mime(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(sniff_image_mime(b"BM\0\0"), Some("image/bmp"));
        assert_eq!(sniff_image_mime(b"GIF89a"), Some("image/gif"));
        assert_eq!(sniff_image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_image_mime(b"<html>"), None);
        assert_eq!(sniff_image_mime(b""), None);
    }

    #[test]
    fn empty_wallpaper_path_means_no_image() {
        assert_eq!(wallpaper_info_for(""), None);
        assert_eq!(wallpaper_info_for("Z:\\definitely\\missing.jpg"), None);
    }
}
