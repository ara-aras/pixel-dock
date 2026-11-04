//! KDE Connect wire format (protocol version 7): one JSON object per line.
//! https://invent.kde.org/network/kdeconnect-kde (reference implementation)

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const PORT: u16 = 1716;
pub const PROTOCOL_VERSION: u32 = 7;
/// Lines longer than this are rejected (a peer cannot make us buffer unbounded data).
pub const MAX_LINE: usize = 1024 * 1024;

pub const PAIR: &str = "kdeconnect.pair";
pub const IDENTITY: &str = "kdeconnect.identity";
pub const PING: &str = "kdeconnect.ping";
pub const BATTERY: &str = "kdeconnect.battery";
pub const BATTERY_REQUEST: &str = "kdeconnect.battery.request";
pub const NOTIFICATION: &str = "kdeconnect.notification";
pub const NOTIFICATION_REQUEST: &str = "kdeconnect.notification.request";
pub const CLIPBOARD: &str = "kdeconnect.clipboard";
pub const CLIPBOARD_CONNECT: &str = "kdeconnect.clipboard.connect";
pub const SHARE: &str = "kdeconnect.share.request";
pub const FIND_MY_PHONE: &str = "kdeconnect.findmyphone.request";

/// What we accept from the phone.
pub const INCOMING: &[&str] = &[PING, BATTERY, NOTIFICATION, CLIPBOARD, CLIPBOARD_CONNECT, SHARE];
/// What we send to the phone.
pub const OUTGOING: &[&str] = &[
    PING,
    BATTERY_REQUEST,
    NOTIFICATION_REQUEST,
    CLIPBOARD,
    CLIPBOARD_CONNECT,
    SHARE,
    FIND_MY_PHONE,
];

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Packet {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub body: Value,
    #[serde(rename = "payloadSize", default, skip_serializing_if = "Option::is_none")]
    pub payload_size: Option<i64>,
    #[serde(rename = "payloadTransferInfo", default, skip_serializing_if = "Option::is_none")]
    pub payload_transfer_info: Option<Value>,
}

impl Packet {
    pub fn new(kind: &str, body: Value) -> Self {
        Packet { id: crate::aerie_db::now_ms(), kind: kind.into(), body, payload_size: None, payload_transfer_info: None }
    }

    pub fn with_payload(mut self, size: u64, port: u16) -> Self {
        self.payload_size = Some(size as i64);
        self.payload_transfer_info = Some(json!({ "port": port }));
        self
    }

    pub fn to_line(&self) -> String {
        let mut s = serde_json::to_string(self).unwrap_or_default();
        s.push('\n');
        s
    }

    pub fn parse(line: &str) -> Option<Packet> {
        let line = line.trim();
        if line.is_empty() || line.len() > MAX_LINE {
            return None;
        }
        serde_json::from_str(line).ok()
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.body.get(key).and_then(Value::as_str)
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        self.body.get(key).and_then(Value::as_bool)
    }

    pub fn payload_port(&self) -> Option<u16> {
        self.payload_transfer_info.as_ref()?.get("port")?.as_u64().and_then(|p| u16::try_from(p).ok())
    }
}

/// Newer KDE Connect clients only accept 32-38 character [A-Za-z0-9_] device ids.
pub fn valid_device_id(id: &str) -> bool {
    (32..=38).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Device names are shown on the phone; keep them short and printable.
pub fn clean_device_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control() && !"\"',;:.!?()[]<>".contains(*c)).collect();
    let trimmed = cleaned.trim();
    let out: String = trimmed.chars().take(32).collect();
    if out.is_empty() { "Aerie PC".into() } else { out }
}

pub fn identity(device_id: &str, device_name: &str, tcp_port: u16) -> Packet {
    Packet::new(
        IDENTITY,
        json!({
            "deviceId": device_id,
            "deviceName": clean_device_name(device_name),
            "deviceType": "desktop",
            "protocolVersion": PROTOCOL_VERSION,
            "incomingCapabilities": INCOMING,
            "outgoingCapabilities": OUTGOING,
            "tcpPort": tcp_port,
        }),
    )
}

/// The parts of a peer's identity packet we use.
#[derive(Debug, Clone, PartialEq)]
pub struct PeerIdentity {
    pub device_id: String,
    pub name: String,
    pub device_type: String,
    pub tcp_port: u16,
}

pub fn parse_identity(p: &Packet) -> Option<PeerIdentity> {
    if p.kind != IDENTITY {
        return None;
    }
    let device_id = p.str("deviceId")?.to_string();
    if !valid_device_id(&device_id) {
        return None;
    }
    Some(PeerIdentity {
        name: clean_device_name(p.str("deviceName").unwrap_or("Phone")),
        device_type: p.str("deviceType").unwrap_or("phone").to_string(),
        tcp_port: p.body.get("tcpPort").and_then(Value::as_u64).and_then(|v| u16::try_from(v).ok()).unwrap_or(PORT),
        device_id,
    })
}

/// A file name from a peer, made safe to create in the Downloads folder:
/// no directories, no reserved characters, no Windows device names.
pub fn safe_download_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let mut cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    cleaned = cleaned.trim().trim_matches('.').to_string();
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if cleaned.is_empty() || reserved {
        cleaned = format!("phone-file-{}", crate::aerie_db::now_ms());
    }
    cleaned.chars().take(180).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_round_trip_and_payload() {
        let p = Packet::new(SHARE, json!({ "filename": "a.jpg" })).with_payload(42, 1739);
        let line = p.to_line();
        assert!(line.ends_with('\n'));
        let back = Packet::parse(&line).unwrap();
        assert_eq!(back, p);
        assert_eq!(back.payload_port(), Some(1739));
        assert!(line.contains("\"payloadSize\":42"));
        assert!(Packet::new(PING, json!({})).to_line().find("payload").is_none());
    }

    #[test]
    fn parse_rejects_junk() {
        assert!(Packet::parse("").is_none());
        assert!(Packet::parse("not json").is_none());
        assert!(Packet::parse("{\"id\":1}").is_none()); // no type
    }

    #[test]
    fn identity_is_well_formed() {
        let id = "0123456789abcdef0123456789abcdef";
        let p = identity(id, "My \"PC\"!", PORT);
        let peer = parse_identity(&Packet::parse(&p.to_line()).unwrap()).unwrap();
        assert_eq!(peer.device_id, id);
        assert_eq!(peer.name, "My PC");
        assert_eq!(peer.tcp_port, PORT);
        assert_eq!(p.body["protocolVersion"], 7);
        assert!(p.body["incomingCapabilities"].as_array().unwrap().iter().any(|c| c == NOTIFICATION));
    }

    #[test]
    fn device_id_validation() {
        assert!(valid_device_id("0123456789abcdef0123456789abcdef"));
        assert!(valid_device_id("_0123456789abcdef0123456789abcdef_"));
        assert!(!valid_device_id("short"));
        assert!(!valid_device_id("0123456789abcdef-0123456789abcdef"));
        assert!(parse_identity(&Packet::new(IDENTITY, json!({ "deviceId": "../../etc" }))).is_none());
    }

    #[test]
    fn download_names_are_safe() {
        assert_eq!(safe_download_name("photo.jpg"), "photo.jpg");
        assert_eq!(safe_download_name("../../Windows/System32/evil.dll"), "evil.dll");
        assert_eq!(safe_download_name("C:\\x\\y\\a<b>.txt"), "a_b_.txt");
        assert!(safe_download_name("CON.txt").starts_with("phone-file-"));
        assert!(safe_download_name("com1").starts_with("phone-file-"));
        assert!(safe_download_name("...").starts_with("phone-file-"));
        assert_eq!(safe_download_name("console.log"), "console.log");
    }
}
