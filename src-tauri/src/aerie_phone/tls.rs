//! TLS for the phone link.
//!
//! KDE Connect devices use self-signed certificates and trust them on pairing
//! (trust-on-first-use, like Bluetooth). So the TLS layer here accepts any peer
//! certificate, and the link layer then pins it: a paired device must present the
//! exact certificate stored when it was paired, or the connection is dropped.

use std::path::Path;
use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{ClientConfig, DigitallySignedStruct, DistinguishedName, ServerConfig, SignatureScheme};

/// Our certificate and key (DER), generated once and kept in the data folder.
pub struct Identity {
    pub cert: CertificateDer<'static>,
    pub key: PrivatePkcs8KeyDer<'static>,
}

impl Clone for Identity {
    fn clone(&self) -> Self {
        Identity { cert: self.cert.clone(), key: self.key.clone_key() }
    }
}

pub fn generate(device_id: &str) -> Result<Identity, String> {
    use rcgen::{CertificateParams, DistinguishedName as Dn, DnType, KeyPair, SerialNumber};
    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let mut params = CertificateParams::new(Vec::<String>::new()).map_err(|e| e.to_string())?;
    let mut dn = Dn::new();
    dn.push(DnType::CommonName, device_id);
    dn.push(DnType::OrganizationName, "KDE");
    dn.push(DnType::OrganizationalUnitName, "Kde connect");
    params.distinguished_name = dn;
    params.serial_number = Some(SerialNumber::from(vec![1]));
    params.not_before = rcgen::date_time_ymd(2020, 1, 1);
    params.not_after = rcgen::date_time_ymd(2045, 1, 1);
    let cert = params.self_signed(&key).map_err(|e| e.to_string())?;
    Ok(Identity {
        cert: cert.der().clone(),
        key: PrivatePkcs8KeyDer::from(key.serialize_der()),
    })
}

/// Load the identity from `dir`, creating it on first use.
pub fn load_or_create(dir: &Path, device_id: &str) -> Result<Identity, String> {
    let (cert_path, key_path) = (dir.join("phone-cert.der"), dir.join("phone-key.der"));
    if let (Ok(cert), Ok(key)) = (std::fs::read(&cert_path), std::fs::read(&key_path)) {
        return Ok(Identity { cert: CertificateDer::from(cert), key: PrivatePkcs8KeyDer::from(key) });
    }
    let id = generate(device_id)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(&cert_path, id.cert.as_ref()).map_err(|e| e.to_string())?;
    std::fs::write(&key_path, id.key.secret_pkcs8_der()).map_err(|e| e.to_string())?;
    Ok(id)
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// Accepts any certificate at the TLS layer; pinning happens after the handshake.
#[derive(Debug)]
struct AcceptAny(Arc<CryptoProvider>);

impl AcceptAny {
    fn tls12(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn tls13(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

impl ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.tls12(m, c, d)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.tls13(m, c, d)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.schemes()
    }
}

impl ClientCertVerifier for AcceptAny {
    fn offer_client_auth(&self) -> bool {
        true
    }
    fn client_auth_mandatory(&self) -> bool {
        true // every peer must present a certificate we can pin
    }
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }
    fn verify_client_cert(&self, _e: &CertificateDer<'_>, _i: &[CertificateDer<'_>], _now: UnixTime) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.tls12(m, c, d)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.tls13(m, c, d)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.schemes()
    }
}

pub fn server_config(id: &Identity) -> Result<Arc<ServerConfig>, String> {
    let p = provider();
    let cfg = ServerConfig::builder_with_provider(p.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_client_cert_verifier(Arc::new(AcceptAny(p)))
        .with_single_cert(vec![id.cert.clone()], PrivateKeyDer::Pkcs8(id.key.clone_key()))
        .map_err(|e| e.to_string())?;
    Ok(Arc::new(cfg))
}

pub fn client_config(id: &Identity) -> Result<Arc<ClientConfig>, String> {
    let p = provider();
    let cfg = ClientConfig::builder_with_provider(p.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAny(p)))
        .with_client_auth_cert(vec![id.cert.clone()], PrivateKeyDer::Pkcs8(id.key.clone_key()))
        .map_err(|e| e.to_string())?;
    Ok(Arc::new(cfg))
}

/// Short, human-checkable fingerprint (first 8 bytes of SHA-256), shown when pairing.
pub fn fingerprint(cert: &[u8]) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, cert);
    digest.as_ref()[..8].iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio_rustls::{TlsAcceptor, TlsConnector};

    /// Two of our own identities complete a mutual-TLS handshake over loopback, each
    /// sees the other's exact certificate (what pinning relies on), and lines flow
    /// both ways. Mirrors the KDE Connect roles: the TCP initiator is the TLS server.
    #[tokio::test]
    async fn mutual_tls_round_trip_and_peer_certs() {
        let a = generate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        let b = generate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let b_cert = b.cert.clone();
        let a_cert = a.cert.clone();

        // "Phone" accepts the TCP connection and acts as TLS client.
        let phone = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let connector = TlsConnector::from(client_config(&b).unwrap());
            let tls = connector.connect(ServerName::try_from("kdeconnect").unwrap(), tcp).await.unwrap();
            let peer = tls.get_ref().1.peer_certificates().unwrap()[0].clone();
            let (r, mut w) = tokio::io::split(tls);
            let mut line = String::new();
            BufReader::new(r).read_line(&mut line).await.unwrap();
            w.write_all(b"pong\n").await.unwrap();
            w.flush().await.unwrap();
            (peer, line)
        });

        // "PC" opened the TCP connection and acts as TLS server.
        let tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let tls = TlsAcceptor::from(server_config(&a).unwrap()).accept(tcp).await.unwrap();
        let peer_seen_by_pc = tls.get_ref().1.peer_certificates().unwrap()[0].clone();
        let (r, mut w) = tokio::io::split(tls);
        w.write_all(b"ping\n").await.unwrap();
        w.flush().await.unwrap();
        let mut reply = String::new();
        BufReader::new(r).read_line(&mut reply).await.unwrap();

        let (peer_seen_by_phone, got) = phone.await.unwrap();
        assert_eq!(got, "ping\n");
        assert_eq!(reply, "pong\n");
        assert_eq!(peer_seen_by_pc.as_ref(), b_cert.as_ref());
        assert_eq!(peer_seen_by_phone.as_ref(), a_cert.as_ref());
    }

    #[test]
    fn identity_persists() {
        let dir = std::env::temp_dir().join(format!("aerie-tls-test-{}", crate::aerie_db::now_ms()));
        let first = load_or_create(&dir, "cccccccccccccccccccccccccccccccc").unwrap();
        let second = load_or_create(&dir, "cccccccccccccccccccccccccccccccc").unwrap();
        assert_eq!(first.cert.as_ref(), second.cert.as_ref());
        assert_eq!(fingerprint(first.cert.as_ref()).len(), 23);
        let _ = std::fs::remove_dir_all(dir);
    }
}
