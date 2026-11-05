//! Phone link: speaks the KDE Connect protocol, so the free KDE Connect app on
//! Android (Play Store / F-Droid) pairs with Aerie directly. No Aerie phone app.
//!
//! Off until the user turns it on (it listens on the LAN and Windows asks about the
//! firewall). Discovery: UDP broadcast on port 1716 both ways; the side that hears
//! the other opens a TCP connection, sends its identity in plain text, then TLS
//! starts with the TCP *initiator* as TLS *server*. Every peer certificate is
//! accepted at the TLS layer and then pinned: a paired phone must present the
//! certificate stored at pairing. Until paired, only pairing packets are handled.
//!
//! Features: phone notifications (with optional Windows toasts), battery, clipboard
//! sync both ways, ring my phone, ping, files both ways (received files go to
//! Downloads), shared text/links (copied to the clipboard, never auto-opened).

pub mod protocol;
pub mod tls;

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use rustls::pki_types::ServerName;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_rustls::{TlsAcceptor, TlsConnector};

use crate::aerie_db::{data_dir, err, now_ms, Db};
use protocol::*;

pub const PHONE_EVENT: &str = "aerie://phone";
const BROADCAST_EVERY: Duration = Duration::from_secs(30);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const PAYLOAD_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_NOTIFICATIONS: usize = 100;
const PAYLOAD_PORTS: std::ops::RangeInclusive<u16> = 1739..=1764;
const MAX_DOWNLOAD: i64 = 4 * 1024 * 1024 * 1024; // 4 GB

// Settings in the kv table (strings).
const K_ENABLED: &str = "phone.enabled";
const K_DEVICE_ID: &str = "phone.device_id";
const K_PAIRED: &str = "phone.paired";
const K_CLIPBOARD: &str = "phone.clipboard_sync";
const K_TOASTS: &str = "phone.toasts";

/// Hash of the last text received from the phone, so it is not echoed back.
static LAST_FROM_PHONE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PhoneNotification {
    pub id: String,
    pub app: String,
    pub title: String,
    pub text: String,
    pub time: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct PairedDevice {
    name: String,
    /// Base64 DER of the certificate seen at pairing.
    cert: String,
}

#[derive(Default)]
struct Device {
    name: String,
    ip: Option<IpAddr>,
    tx: Option<UnboundedSender<String>>,
    /// Identifies the live link, so a replaced link's cleanup leaves the new one alone.
    link_id: u64,
    /// Closes the live link when a newer connection from the same phone replaces it.
    close: Option<tokio::sync::oneshot::Sender<()>>,
    cert: Option<Vec<u8>>,
    battery: Option<(i64, bool)>,
    notifications: Vec<PhoneNotification>,
    incoming_pair: bool,
    pending_pair: bool,
}

#[derive(Clone)]
struct Local {
    device_id: String,
    name: String,
    identity: tls::Identity,
    server: Arc<rustls::ServerConfig>,
    client: Arc<rustls::ClientConfig>,
}

#[derive(Default)]
struct Inner {
    enabled: bool,
    status: String,
    local: Option<Local>,
    devices: HashMap<String, Device>,
    tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Default)]
pub struct PhoneService(Mutex<Inner>);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

fn kv_get(app: &AppHandle, key: &str) -> Option<String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().ok()?;
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).ok()
}

fn kv_set(app: &AppHandle, key: &str, value: &str) {
    let db = app.state::<Db>();
    let guard = db.0.lock();
    if let Ok(conn) = guard {
        let _ = conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        );
    }
}

fn setting_on(app: &AppHandle, key: &str) -> bool {
    kv_get(app, key).map(|v| v != "0").unwrap_or(true) // default on
}

fn paired_devices(app: &AppHandle) -> HashMap<String, PairedDevice> {
    kv_get(app, K_PAIRED).and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

fn save_paired(app: &AppHandle, map: &HashMap<String, PairedDevice>) {
    kv_set(app, K_PAIRED, &serde_json::to_string(map).unwrap_or_else(|_| "{}".into()));
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn text_hash(s: &str) -> u64 {
    crate::aerie_clipboard::fnv1a(&[s.as_bytes()])
        .get(..16)
        .and_then(|h| u64::from_str_radix(h, 16).ok())
        .unwrap_or(0)
}

fn svc(app: &AppHandle) -> State<'_, PhoneService> {
    app.state::<PhoneService>()
}

fn changed(app: &AppHandle) {
    let _ = app.emit(PHONE_EVENT, ());
}

fn set_status(app: &AppHandle, status: impl Into<String>) {
    if let Ok(mut i) = svc(app).0.lock() {
        i.status = status.into();
    }
    changed(app);
}

fn toast(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

fn local(app: &AppHandle) -> Option<Local> {
    svc(app).0.lock().ok()?.local.clone()
}

fn device_name(app: &AppHandle, id: &str) -> String {
    svc(app)
        .0
        .lock()
        .ok()
        .and_then(|i| i.devices.get(id).map(|d| d.name.clone()))
        .unwrap_or_else(|| "Phone".into())
}

/// Queue a packet for a connected device.
fn send(app: &AppHandle, id: &str, packet: Packet) -> Result<(), String> {
    // Only pairing traffic may go to a phone we have not paired with: clipboard
    // text, files and pings must never reach an unverified device.
    if packet.kind != PAIR && !is_paired(app, id) {
        return Err("pair with this phone first".into());
    }
    let tx = svc(app)
        .0
        .lock()
        .map_err(err)?
        .devices
        .get(id)
        .and_then(|d| d.tx.clone())
        .ok_or("phone is not connected")?;
    tx.send(packet.to_line()).map_err(|_| "phone disconnected".to_string())
}

fn is_paired(app: &AppHandle, id: &str) -> bool {
    paired_devices(app).contains_key(id)
}

/// Read one '\n'-terminated line byte by byte (before TLS: must not read past it).
async fn read_plain_line(stream: &mut TcpStream, max: usize) -> std::io::Result<String> {
    let mut out = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        if stream.read(&mut byte).await? == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        if byte[0] == b'\n' {
            break;
        }
        out.push(byte[0]);
        if out.len() > max {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
    }
    String::from_utf8(out).map_err(|_| std::io::ErrorKind::InvalidData.into())
}

/// Read a line of at most `max` bytes; Ok(None) at end of stream.
async fn read_line_limited<R: AsyncBufRead + Unpin>(r: &mut R, max: usize) -> std::io::Result<Option<String>> {
    let mut out = Vec::new();
    loop {
        let buf = r.fill_buf().await?;
        if buf.is_empty() {
            return Ok(if out.is_empty() { None } else { Some(String::from_utf8_lossy(&out).into_owned()) });
        }
        if let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            out.extend_from_slice(&buf[..pos]);
            r.consume(pos + 1);
            if out.len() > max {
                return Err(std::io::ErrorKind::InvalidData.into());
            }
            return Ok(Some(String::from_utf8_lossy(&out).into_owned()));
        }
        let n = buf.len();
        out.extend_from_slice(buf);
        r.consume(n);
        if out.len() > max {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
    }
}

/// This PC's LAN address, for "Add device by IP" on the phone. Sends no packets.
fn lan_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    Some(s.local_addr().ok()?.ip().to_string())
}

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------

fn load_local(app: &AppHandle) -> Result<Local, String> {
    let device_id = match kv_get(app, K_DEVICE_ID).filter(|id| valid_device_id(id)) {
        Some(id) => id,
        None => {
            let id = uuid_hex();
            kv_set(app, K_DEVICE_ID, &id);
            id
        }
    };
    let identity = tls::load_or_create(&data_dir().join("phone"), &device_id)?;
    let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Aerie PC".into());
    Ok(Local {
        server: tls::server_config(&identity)?,
        client: tls::client_config(&identity)?,
        device_id,
        name,
        identity,
    })
}

/// 32 hex characters (KDE Connect's device id format), from the OS RNG.
fn uuid_hex() -> String {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut bytes = [0u8; 16];
    let _ = SystemRandom::new().fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn start_if_enabled(app: &AppHandle) {
    if kv_get(app, K_ENABLED).as_deref() == Some("1") {
        if let Err(e) = enable(app) {
            set_status(app, format!("Could not start: {e}"));
        }
    }
}

fn enable(app: &AppHandle) -> Result<(), String> {
    let local = load_local(app)?;
    let state = svc(app);
    {
        let mut i = state.0.lock().map_err(err)?;
        if i.enabled {
            return Ok(());
        }
        i.enabled = true;
        i.status = "Looking for phones".into();
        i.local = Some(local);
        for t in [
            tauri::async_runtime::spawn(udp_listener(app.clone())),
            tauri::async_runtime::spawn(tcp_listener(app.clone())),
            tauri::async_runtime::spawn(broadcaster(app.clone())),
        ] {
            i.tasks.push(t);
        }
    }
    changed(app);
    Ok(())
}

fn disable(app: &AppHandle) {
    if let Ok(mut i) = svc(app).0.lock() {
        i.enabled = false;
        i.status = "Off".into();
        for t in i.tasks.drain(..) {
            t.abort();
        }
        for d in i.devices.values_mut() {
            d.tx = None;
            if let Some(c) = d.close.take() {
                let _ = c.send(());
            }
            d.incoming_pair = false;
            d.pending_pair = false;
        }
    }
    changed(app);
}

fn track(app: &AppHandle, task: tauri::async_runtime::JoinHandle<()>) {
    if let Ok(mut i) = svc(app).0.lock() {
        i.tasks.retain(|t| !t.inner().is_finished());
        i.tasks.push(task);
    }
}

// ---------------------------------------------------------------------------
// Discovery and connections
// ---------------------------------------------------------------------------

async fn broadcaster(app: AppHandle) {
    loop {
        if let (Some(l), Ok(sock)) = (local(&app), UdpSocket::bind("0.0.0.0:0").await) {
            let _ = sock.set_broadcast(true);
            let line = identity(&l.device_id, &l.name, PORT).to_line();
            let _ = sock.send_to(line.as_bytes(), ("255.255.255.255", PORT)).await;
        }
        tokio::time::sleep(BROADCAST_EVERY).await;
    }
}

async fn udp_listener(app: AppHandle) {
    let sock = match UdpSocket::bind(("0.0.0.0", PORT)).await {
        Ok(s) => s,
        Err(e) => {
            set_status(&app, format!("UDP port {PORT} is busy ({e}). Is the KDE Connect desktop app running?"));
            return;
        }
    };
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let Ok((n, from)) = sock.recv_from(&mut buf).await else { continue };
        let Some(peer) = std::str::from_utf8(&buf[..n]).ok().and_then(Packet::parse).as_ref().and_then(parse_identity) else {
            continue;
        };
        let Some(l) = local(&app) else { return };
        let connected = svc(&app).0.lock().map(|i| i.devices.get(&peer.device_id).is_some_and(|d| d.tx.is_some())).unwrap_or(true);
        if peer.device_id == l.device_id || connected {
            continue;
        }
        let task = tauri::async_runtime::spawn(connect_out(app.clone(), peer, from.ip()));
        track(&app, task);
    }
}

async fn tcp_listener(app: AppHandle) {
    let listener = match TcpListener::bind(("0.0.0.0", PORT)).await {
        Ok(l) => l,
        Err(e) => {
            set_status(&app, format!("TCP port {PORT} is busy ({e}). Is the KDE Connect desktop app running?"));
            return;
        }
    };
    loop {
        let Ok((stream, addr)) = listener.accept().await else { continue };
        let task = tauri::async_runtime::spawn(handle_incoming(app.clone(), stream, addr.ip()));
        track(&app, task);
    }
}

/// The phone connected to us: read its identity, then we are the TLS client.
async fn handle_incoming(app: AppHandle, mut stream: TcpStream, ip: IpAddr) {
    let Some(l) = local(&app) else { return };
    let Ok(Ok(line)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, read_plain_line(&mut stream, 64 * 1024)).await else { return };
    let Some(peer) = Packet::parse(&line).as_ref().and_then(parse_identity) else { return };
    if peer.device_id == l.device_id {
        return;
    }
    let connector = TlsConnector::from(l.client.clone());
    let name = ServerName::try_from("kdeconnect").expect("static name");
    let Ok(Ok(tls)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, connector.connect(name, stream)).await else { return };
    let cert = tls.get_ref().1.peer_certificates().and_then(|c| c.first()).map(|c| c.to_vec());
    run_link(app, peer, ip, tls, cert).await;
}

/// We heard the phone: connect, send our identity, then we are the TLS server.
async fn connect_out(app: AppHandle, peer: PeerIdentity, ip: IpAddr) {
    let Some(l) = local(&app) else { return };
    let Ok(Ok(mut stream)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, TcpStream::connect((ip, peer.tcp_port))).await else { return };
    if stream.write_all(identity(&l.device_id, &l.name, PORT).to_line().as_bytes()).await.is_err() {
        return;
    }
    let acceptor = TlsAcceptor::from(l.server.clone());
    let Ok(Ok(tls)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await else { return };
    let cert = tls.get_ref().1.peer_certificates().and_then(|c| c.first()).map(|c| c.to_vec());
    run_link(app, peer, ip, tls, cert).await;
}

/// One live, encrypted connection to a phone.
async fn run_link<S>(app: AppHandle, peer: PeerIdentity, ip: IpAddr, stream: S, cert: Option<Vec<u8>>)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let Some(cert) = cert else { return };
    // Pinning: a paired device must present the certificate it paired with.
    if let Some(p) = paired_devices(&app).get(&peer.device_id) {
        if p.cert != b64(&cert) {
            set_status(&app, format!("Rejected {}: its certificate changed. Unpair and pair again if you reset the phone.", peer.name));
            return;
        }
    }

    static NEXT_LINK: AtomicU64 = AtomicU64::new(1);
    let link_id = NEXT_LINK.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = unbounded_channel::<String>();
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel::<()>();
    let state = svc(&app);
    {
        let Ok(mut i) = state.0.lock() else { return };
        let d = i.devices.entry(peer.device_id.clone()).or_default();
        // A newer connection wins. The old one may be a dead socket the phone left
        // behind (Wi-Fi switch, sleep), which would otherwise block reconnecting
        // until TCP noticed, possibly many minutes later.
        if let Some(old) = d.close.take() {
            let _ = old.send(());
        }
        d.name = peer.name.clone();
        d.ip = Some(ip);
        d.tx = Some(tx);
        d.link_id = link_id;
        d.close = Some(close_tx);
        d.cert = Some(cert);
        i.status = "Connected".into();
    }
    changed(&app);

    let (reader, mut writer) = tokio::io::split(stream);
    let writer_task = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if writer.write_all(line.as_bytes()).await.is_err() || writer.flush().await.is_err() {
                break;
            }
        }
    });

    if is_paired(&app, &peer.device_id) {
        on_paired_link_up(&app, &peer.device_id);
    }

    let mut reader = BufReader::new(reader);
    loop {
        let line = tokio::select! {
            r = read_line_limited(&mut reader, MAX_LINE) => r,
            _ = &mut close_rx => break, // replaced by a newer link
        };
        let Ok(Some(line)) = line else { break };
        if let Some(packet) = Packet::parse(&line) {
            handle_packet(&app, &peer.device_id, ip, packet).await;
        }
    }

    writer_task.abort();
    if let Ok(mut i) = svc(&app).0.lock() {
        if let Some(d) = i.devices.get_mut(&peer.device_id) {
            if d.link_id != link_id {
                return; // a newer link owns this device now
            }
            d.tx = None;
            d.close = None;
            d.incoming_pair = false;
            d.pending_pair = false;
        }
        if i.enabled && !i.devices.values().any(|d| d.tx.is_some()) {
            i.status = "Looking for phones".into();
        }
    }
    changed(&app);
}

fn on_paired_link_up(app: &AppHandle, id: &str) {
    let _ = send(app, id, Packet::new(BATTERY_REQUEST, json!({ "request": true })));
    let _ = send(app, id, Packet::new(NOTIFICATION_REQUEST, json!({ "request": true })));
}

// ---------------------------------------------------------------------------
// Packets from the phone
// ---------------------------------------------------------------------------

/// Notification packet -> our record. None for cancellations. Pure, for tests.
pub fn parse_notification(p: &Packet) -> Option<PhoneNotification> {
    let id = p.str("id")?.to_string();
    if p.bool("isCancel").unwrap_or(false) {
        return None;
    }
    let time = p
        .body
        .get("time")
        .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or_else(now_ms);
    Some(PhoneNotification {
        app: p.str("appName").unwrap_or("Phone").to_string(),
        title: p.str("title").or_else(|| p.str("ticker")).unwrap_or("").to_string(),
        text: p.str("text").unwrap_or("").to_string(),
        time,
        id,
    })
}

async fn handle_packet(app: &AppHandle, id: &str, ip: IpAddr, p: Packet) {
    let name = device_name(app, id);
    if p.kind == PAIR {
        handle_pair(app, id, &name, p.bool("pair").unwrap_or(false));
        return;
    }
    if !is_paired(app, id) {
        return; // nothing else is accepted from unpaired devices
    }
    match p.kind.as_str() {
        PING => toast(app, &name, p.str("message").unwrap_or("Ping!")),
        BATTERY => {
            let charge = p.body.get("currentCharge").and_then(|v| v.as_i64()).unwrap_or(-1);
            let charging = p.bool("isCharging").unwrap_or(false);
            if let Ok(mut i) = svc(app).0.lock() {
                if let Some(d) = i.devices.get_mut(id) {
                    d.battery = (charge >= 0).then_some((charge, charging));
                }
            }
            changed(app);
        }
        NOTIFICATION => {
            let cancel_id = p.str("id").map(String::from);
            let silent = p.bool("silent").unwrap_or(false);
            let parsed = parse_notification(&p);
            let mut is_new = false;
            if let Ok(mut i) = svc(app).0.lock() {
                if let Some(d) = i.devices.get_mut(id) {
                    match &parsed {
                        None => d.notifications.retain(|n| Some(&n.id) != cancel_id.as_ref()),
                        Some(n) => {
                            is_new = !d.notifications.iter().any(|x| x.id == n.id);
                            d.notifications.retain(|x| x.id != n.id);
                            d.notifications.insert(0, n.clone());
                            d.notifications.truncate(MAX_NOTIFICATIONS);
                        }
                    }
                }
            }
            if let Some(n) = parsed {
                if is_new && !silent && setting_on(app, K_TOASTS) && !(n.title.is_empty() && n.text.is_empty()) {
                    let title = if n.title.is_empty() { n.app.clone() } else { format!("{} · {}", n.app, n.title) };
                    toast(app, &title, &n.text);
                }
            }
            changed(app);
        }
        CLIPBOARD | CLIPBOARD_CONNECT => {
            if let Some(content) = p.str("content").filter(|c| !c.is_empty()) {
                if setting_on(app, K_CLIPBOARD) {
                    LAST_FROM_PHONE.store(text_hash(content), Ordering::SeqCst);
                    let _ = crate::aerie_clipboard::aerie_clipboard_write_text(content.to_string());
                }
            }
        }
        SHARE => {
            if let Some(text) = p.str("text").or_else(|| p.str("url")) {
                // Shared text or links are copied, never opened automatically.
                LAST_FROM_PHONE.store(text_hash(text), Ordering::SeqCst);
                let _ = crate::aerie_clipboard::aerie_clipboard_write_text(text.to_string());
                toast(app, &name, "Shared text copied to the clipboard");
            } else if let (Some(file), Some(port), Some(size)) = (p.str("filename"), p.payload_port(), p.payload_size) {
                let app = app.clone();
                let file = file.to_string();
                tauri::async_runtime::spawn(async move {
                    match download(&app, ip, port, size, &file).await {
                        Ok(saved) => toast(&app, "File from phone", &format!("Saved {saved} to Downloads")),
                        Err(e) => toast(&app, "File from phone failed", &e),
                    }
                });
            }
        }
        _ => {}
    }
}

fn handle_pair(app: &AppHandle, id: &str, name: &str, want: bool) {
    if !want {
        let mut map = paired_devices(app);
        map.remove(id);
        save_paired(app, &map);
        if let Ok(mut i) = svc(app).0.lock() {
            if let Some(d) = i.devices.get_mut(id) {
                d.pending_pair = false;
                d.incoming_pair = false;
            }
        }
        changed(app);
        return;
    }
    let (we_asked, cert) = svc(app)
        .0
        .lock()
        .ok()
        .and_then(|i| i.devices.get(id).map(|d| (d.pending_pair, d.cert.clone())))
        .unwrap_or((false, None));
    if we_asked || is_paired(app, id) {
        if let Some(cert) = cert {
            complete_pairing(app, id, name, &cert);
            if !we_asked {
                let _ = send(app, id, Packet::new(PAIR, json!({ "pair": true })));
            }
        }
    } else {
        if let Ok(mut i) = svc(app).0.lock() {
            if let Some(d) = i.devices.get_mut(id) {
                d.incoming_pair = true;
            }
        }
        toast(app, "Pairing request", &format!("{name} wants to pair. Accept it in Aerie's Phone tab."));
        changed(app);
    }
}

fn complete_pairing(app: &AppHandle, id: &str, name: &str, cert: &[u8]) {
    let mut map = paired_devices(app);
    map.insert(id.to_string(), PairedDevice { name: name.to_string(), cert: b64(cert) });
    save_paired(app, &map);
    if let Ok(mut i) = svc(app).0.lock() {
        if let Some(d) = i.devices.get_mut(id) {
            d.pending_pair = false;
            d.incoming_pair = false;
        }
    }
    on_paired_link_up(app, id);
    changed(app);
}

// ---------------------------------------------------------------------------
// File transfer (payloads): the uploader listens and is the TLS server.
// ---------------------------------------------------------------------------

async fn download(app: &AppHandle, ip: IpAddr, port: u16, size: i64, name: &str) -> Result<String, String> {
    if !(0..=MAX_DOWNLOAD).contains(&size) {
        return Err("file too large".into());
    }
    let l = local(app).ok_or("phone link is off")?;
    let dir = app.path().download_dir().map_err(err)?;
    let safe = safe_download_name(name);
    let mut path = dir.join(&safe);
    let mut n = 1;
    while path.exists() {
        let (stem, ext) = match safe.rsplit_once('.') {
            Some((s, e)) => (s.to_string(), format!(".{e}")),
            None => (safe.clone(), String::new()),
        };
        path = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    let tcp = tokio::time::timeout(PAYLOAD_TIMEOUT, TcpStream::connect((ip, port))).await.map_err(err)?.map_err(err)?;
    let name_ref = ServerName::try_from("kdeconnect").expect("static name");
    let tls = TlsConnector::from(l.client.clone()).connect(name_ref, tcp).await.map_err(err)?;
    let mut file = tokio::fs::File::create(&path).await.map_err(err)?;
    let copied = tokio::time::timeout(Duration::from_secs(3600), tokio::io::copy(&mut tls.take(size as u64), &mut file))
        .await
        .map_err(|_| "transfer timed out".to_string())?
        .map_err(err)?;
    file.flush().await.map_err(err)?;
    if copied != size as u64 {
        let _ = tokio::fs::remove_file(&path).await;
        return Err("transfer was cut short".into());
    }
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(safe))
}

async fn upload(app: AppHandle, id: String, path: String) -> Result<(), String> {
    let l = local(&app).ok_or("phone link is off")?;
    let meta = tokio::fs::metadata(&path).await.map_err(err)?;
    if !meta.is_file() {
        return Err("only files can be sent".into());
    }
    let mut listener = None;
    for port in PAYLOAD_PORTS {
        if let Ok(li) = TcpListener::bind(("0.0.0.0", port)).await {
            listener = Some((li, port));
            break;
        }
    }
    let (listener, port) = listener.ok_or("no free transfer port (1739-1764)")?;
    let filename = std::path::Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    send(&app, &id, Packet::new(SHARE, json!({ "filename": filename, "open": false })).with_payload(meta.len(), port))?;
    let (tcp, _) = tokio::time::timeout(PAYLOAD_TIMEOUT, listener.accept()).await.map_err(|_| "the phone did not start the transfer".to_string())?.map_err(err)?;
    let mut tls = TlsAcceptor::from(l.server.clone()).accept(tcp).await.map_err(err)?;
    let mut file = tokio::fs::File::open(&path).await.map_err(err)?;
    tokio::io::copy(&mut file, &mut tls).await.map_err(err)?;
    tls.shutdown().await.map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// From the rest of Aerie
// ---------------------------------------------------------------------------

/// Called by the clipboard watcher for each new text copy on the PC.
pub fn on_local_text(app: &AppHandle, text: &str) {
    if text_hash(text) == LAST_FROM_PHONE.load(Ordering::SeqCst) || !setting_on(app, K_CLIPBOARD) {
        return; // it came from the phone, or sync is off
    }
    let targets: Vec<String> = match svc(app).0.lock() {
        Ok(i) if i.enabled => i.devices.iter().filter(|(_, d)| d.tx.is_some()).map(|(id, _)| id.clone()).collect(),
        _ => return,
    };
    let paired = paired_devices(app);
    for id in targets.iter().filter(|id| paired.contains_key(*id)) {
        let _ = send(app, id, Packet::new(CLIPBOARD, json!({ "content": text })));
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct DeviceView {
    id: String,
    name: String,
    paired: bool,
    connected: bool,
    battery: Option<i64>,
    charging: bool,
    incoming_pair: bool,
    pending_pair: bool,
    fingerprint: Option<String>,
    notifications: Vec<PhoneNotification>,
}

#[derive(Serialize)]
pub struct PhoneState {
    enabled: bool,
    status: String,
    name: String,
    fingerprint: Option<String>,
    ip: Option<String>,
    clipboard_sync: bool,
    toasts: bool,
    devices: Vec<DeviceView>,
}

#[tauri::command]
pub fn aerie_phone_state(app: AppHandle) -> Result<PhoneState, String> {
    let paired = paired_devices(&app);
    let state = svc(&app);
    let i = state.0.lock().map_err(err)?;
    let mut ids: Vec<String> = i.devices.keys().cloned().collect();
    for id in paired.keys() {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    let mut devices: Vec<DeviceView> = ids
        .into_iter()
        .map(|id| {
            let d = i.devices.get(&id);
            let p = paired.get(&id);
            DeviceView {
                name: d.map(|d| d.name.clone()).or_else(|| p.map(|p| p.name.clone())).unwrap_or_default(),
                paired: p.is_some(),
                connected: d.is_some_and(|d| d.tx.is_some()),
                battery: d.and_then(|d| d.battery.map(|b| b.0)),
                charging: d.and_then(|d| d.battery.map(|b| b.1)).unwrap_or(false),
                incoming_pair: d.is_some_and(|d| d.incoming_pair),
                pending_pair: d.is_some_and(|d| d.pending_pair),
                fingerprint: d.and_then(|d| d.cert.as_deref().map(tls::fingerprint)),
                notifications: d.map(|d| d.notifications.clone()).unwrap_or_default(),
                id,
            }
        })
        .collect();
    devices.sort_by(|a, b| (b.connected, b.paired).cmp(&(a.connected, a.paired)).then(a.name.cmp(&b.name)));
    Ok(PhoneState {
        enabled: i.enabled,
        status: if i.enabled { i.status.clone() } else { "Off".into() },
        name: i.local.as_ref().map(|l| l.name.clone()).unwrap_or_else(|| std::env::var("COMPUTERNAME").unwrap_or_default()),
        fingerprint: i.local.as_ref().map(|l| tls::fingerprint(l.identity.cert.as_ref())),
        ip: lan_ip(),
        clipboard_sync: setting_on(&app, K_CLIPBOARD),
        toasts: setting_on(&app, K_TOASTS),
        devices,
    })
}

#[tauri::command]
pub fn aerie_phone_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    kv_set(&app, K_ENABLED, if enabled { "1" } else { "0" });
    if enabled {
        enable(&app)
    } else {
        disable(&app);
        Ok(())
    }
}

#[tauri::command]
pub fn aerie_phone_set_option(app: AppHandle, option: String, on: bool) -> Result<(), String> {
    let key = match option.as_str() {
        "clipboard_sync" => K_CLIPBOARD,
        "toasts" => K_TOASTS,
        _ => return Err("unknown option".into()),
    };
    kv_set(&app, key, if on { "1" } else { "0" });
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn aerie_phone_pair(app: AppHandle, id: String) -> Result<(), String> {
    if let Ok(mut i) = svc(&app).0.lock() {
        if let Some(d) = i.devices.get_mut(&id) {
            d.pending_pair = true;
        }
    }
    changed(&app);
    send(&app, &id, Packet::new(PAIR, json!({ "pair": true })))
}

#[tauri::command]
pub fn aerie_phone_answer_pair(app: AppHandle, id: String, accept: bool) -> Result<(), String> {
    let (name, cert) = svc(&app)
        .0
        .lock()
        .map_err(err)?
        .devices
        .get(&id)
        .map(|d| (d.name.clone(), d.cert.clone()))
        .ok_or("phone is not connected")?;
    send(&app, &id, Packet::new(PAIR, json!({ "pair": accept })))?;
    if accept {
        complete_pairing(&app, &id, &name, &cert.ok_or("no certificate")?);
    } else if let Ok(mut i) = svc(&app).0.lock() {
        if let Some(d) = i.devices.get_mut(&id) {
            d.incoming_pair = false;
        }
    }
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn aerie_phone_unpair(app: AppHandle, id: String) -> Result<(), String> {
    let _ = send(&app, &id, Packet::new(PAIR, json!({ "pair": false })));
    handle_pair(&app, &id, "", false);
    Ok(())
}

#[tauri::command]
pub fn aerie_phone_ring(app: AppHandle, id: String) -> Result<(), String> {
    send(&app, &id, Packet::new(FIND_MY_PHONE, json!({})))
}

#[tauri::command]
pub fn aerie_phone_ping(app: AppHandle, id: String) -> Result<(), String> {
    send(&app, &id, Packet::new(PING, json!({ "message": "Ping from Aerie" })))
}

#[tauri::command]
pub fn aerie_phone_send_text(app: AppHandle, id: String, text: String) -> Result<(), String> {
    send(&app, &id, Packet::new(CLIPBOARD, json!({ "content": text })))
}

#[tauri::command]
pub fn aerie_phone_dismiss(app: AppHandle, id: String, notification_id: String) -> Result<(), String> {
    if let Ok(mut i) = svc(&app).0.lock() {
        if let Some(d) = i.devices.get_mut(&id) {
            d.notifications.retain(|n| n.id != notification_id);
        }
    }
    changed(&app);
    send(&app, &id, Packet::new(NOTIFICATION_REQUEST, json!({ "cancel": notification_id })))
}

/// Send files one after another; each gets its own transfer connection.
#[tauri::command]
pub async fn aerie_phone_send_files(app: AppHandle, id: String, paths: Vec<String>) -> Result<(), String> {
    let mut failed = Vec::new();
    for path in paths {
        if let Err(e) = upload(app.clone(), id.clone(), path.clone()).await {
            failed.push(format!("{path}: {e}"));
        }
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(failed.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_parsing() {
        let p = Packet::new(NOTIFICATION, json!({ "id": "0|com.whatsapp|1", "appName": "WhatsApp", "title": "Sam", "text": "hi", "time": "1700000000000" }));
        let n = parse_notification(&p).unwrap();
        assert_eq!((n.app.as_str(), n.title.as_str(), n.text.as_str(), n.time), ("WhatsApp", "Sam", "hi", 1_700_000_000_000));
        let cancel = Packet::new(NOTIFICATION, json!({ "id": "0|com.whatsapp|1", "isCancel": true }));
        assert!(parse_notification(&cancel).is_none());
        let ticker = Packet::new(NOTIFICATION, json!({ "id": "x", "ticker": "Missed call" }));
        assert_eq!(parse_notification(&ticker).unwrap().title, "Missed call");
    }

    #[test]
    fn device_ids_are_valid() {
        let id = uuid_hex();
        assert!(valid_device_id(&id), "{id}");
        assert_ne!(uuid_hex(), id);
    }

    #[tokio::test]
    async fn limited_line_reader() {
        let data: &[u8] = b"short\nthis line is far too long\nend";
        let mut r = BufReader::new(data);
        assert_eq!(read_line_limited(&mut r, 10).await.unwrap().as_deref(), Some("short"));
        assert!(read_line_limited(&mut r, 10).await.is_err());
        let mut r = BufReader::new(&b"a\nb"[..]);
        assert_eq!(read_line_limited(&mut r, 10).await.unwrap().as_deref(), Some("a"));
        assert_eq!(read_line_limited(&mut r, 10).await.unwrap().as_deref(), Some("b"));
        assert_eq!(read_line_limited(&mut r, 10).await.unwrap(), None);
    }
}
