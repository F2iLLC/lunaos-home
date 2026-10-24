//! Fictional native envelope experiment. Not linked into the Home application.
use super::*;
use std::io::Read;
use std::os::windows::ffi::OsStrExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::HWND;
use windows::Win32::Security::Cryptography::*;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};
use windows::Win32::UI::WindowsAndMessaging::*;
#[path = "../../src/windows_session.rs"]
#[allow(dead_code)]
mod session;

const MAGIC: &str = "LunaOSHome.FictionalEnvelope.1";
const FIXTURE: &[u8] = b"Fictional Alex: blue paper kite";
const MAX_FILE: u64 = 8192;
type Result<T> = std::result::Result<T, &'static str>;
static KEY_ACTIVE: AtomicBool = AtomicBool::new(false);
static KEY_FOREGROUND: AtomicBool = AtomicBool::new(false);
struct ActiveKey;
impl ActiveKey {
    fn begin() -> Self {
        KEY_FOREGROUND.store(false, Ordering::SeqCst);
        KEY_ACTIVE.store(true, Ordering::SeqCst);
        Self
    }
}
impl Drop for ActiveKey {
    fn drop(&mut self) {
        KEY_ACTIVE.store(false, Ordering::SeqCst);
    }
}

// Volatile stores cover owned buffers, not OS paging, crash dumps, compiler
// copies, or a compromised same-user process.
pub(super) fn wipe(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}
struct Secret(Vec<u8>);
impl Drop for Secret {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}
fn data_key() -> Result<Secret> {
    let mut key = Secret(vec![0; 32]);
    if unsafe { BCryptGenRandom(None, &mut key.0, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.0 < 0 {
        return Err("random-unavailable");
    }
    Ok(key)
}
struct Algorithm(BCRYPT_ALG_HANDLE);
impl Drop for Algorithm {
    fn drop(&mut self) {
        let _ = unsafe { BCryptCloseAlgorithmProvider(self.0, 0) };
    }
}
struct AesKey(BCRYPT_KEY_HANDLE);
impl Drop for AesKey {
    fn drop(&mut self) {
        let _ = unsafe { BCryptDestroyKey(self.0) };
    }
}

// Windows CNG AES-256-GCM; the complete canonical header is authenticated as AAD.
fn gcm(
    key: &Secret,
    nonce: &[u8; 12],
    aad: &[u8],
    input: &[u8],
    tag: &mut [u8; 16],
    decrypt: bool,
) -> Result<Secret> {
    if key.0.len() != 32 || input.len() > 1024 || aad.len() > MAX_FILE as usize {
        return Err("envelope-invalid");
    }
    let mut algorithm = BCRYPT_ALG_HANDLE::default();
    if unsafe {
        BCryptOpenAlgorithmProvider(
            &mut algorithm,
            BCRYPT_AES_ALGORITHM,
            PCWSTR::null(),
            BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS(0),
        )
    }
    .0 < 0
    {
        return Err("cipher-unavailable");
    }
    let algorithm = Algorithm(algorithm);
    let mode: Vec<u8> = "ChainingModeGCM\0"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    if unsafe { BCryptSetProperty(algorithm.0.into(), BCRYPT_CHAINING_MODE, &mode, 0) }.0 < 0 {
        return Err("cipher-unavailable");
    }
    let mut handle = BCRYPT_KEY_HANDLE::default();
    if unsafe { BCryptGenerateSymmetricKey(algorithm.0, &mut handle, None, &key.0, 0) }.0 < 0 {
        return Err("cipher-unavailable");
    }
    let handle = AesKey(handle);
    let info = BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO {
        cbSize: size_of::<BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO>() as u32,
        dwInfoVersion: BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO_VERSION,
        pbNonce: nonce.as_ptr() as *mut u8,
        cbNonce: nonce.len() as u32,
        pbAuthData: aad.as_ptr() as *mut u8,
        cbAuthData: aad.len() as u32,
        pbTag: tag.as_mut_ptr(),
        cbTag: tag.len() as u32,
        ..Default::default()
    };
    let mut output = Secret(vec![0; input.len()]);
    let mut count = 0;
    let info = &info as *const _ as *const std::ffi::c_void;
    let status = unsafe {
        if decrypt {
            BCryptDecrypt(
                handle.0,
                Some(input),
                Some(info),
                None,
                Some(&mut output.0),
                &mut count,
                BCRYPT_FLAGS(0),
            )
        } else {
            BCryptEncrypt(
                handle.0,
                Some(input),
                Some(info),
                None,
                Some(&mut output.0),
                &mut count,
                BCRYPT_FLAGS(0),
            )
        }
    };
    if status.0 < 0 || count as usize != input.len() {
        return Err("envelope-authentication-failed");
    }
    Ok(output)
}

#[derive(Clone)]
struct Envelope {
    name: String,
    boot: u64,
    wrapped: Vec<u8>,
    nonce: [u8; 12],
    cipher: Vec<u8>,
    tag: [u8; 16],
}
impl Envelope {
    fn header(&self) -> String {
        format!(
            "{MAGIC}\nsoftware-rsa-oaep-sha256-aes256-gcm\n{}\n{}\n{}\n{}\n",
            self.name,
            self.boot,
            hex(&self.wrapped),
            hex(&self.nonce)
        )
    }
    fn encode(&self) -> Vec<u8> {
        format!(
            "{}{}\n{}\n",
            self.header(),
            hex(&self.cipher),
            hex(&self.tag)
        )
        .into_bytes()
    }
    fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_FILE as usize {
            return Err("envelope-invalid");
        }
        let text = std::str::from_utf8(bytes).map_err(|_| "envelope-invalid")?;
        let parts: Vec<&str> = text.split('\n').collect();
        if parts.len() != 9
            || parts[0] != MAGIC
            || parts[1] != "software-rsa-oaep-sha256-aes256-gcm"
            || parts[8] != ""
        {
            return Err("envelope-invalid");
        }
        let name = parts[2];
        if name.len() != 63
            || !name.starts_with("LunaOSHome.FictionalKeyRelease.")
            || !name[31..].bytes().all(|v| v.is_ascii_hexdigit())
        {
            return Err("envelope-invalid");
        }
        let get = |index| unhex(parts[index]).ok_or("envelope-invalid");
        let wrapped = get(4)?;
        if wrapped.len() != 256 {
            return Err("envelope-invalid");
        }
        let result = Self {
            name: name.to_owned(),
            boot: parse_boot_time(parts[3]).ok_or("envelope-invalid")?,
            wrapped,
            nonce: get(5)?.try_into().map_err(|_| "envelope-invalid")?,
            cipher: get(6)?,
            tag: get(7)?.try_into().map_err(|_| "envelope-invalid")?,
        };
        if result.cipher.len() != FIXTURE.len() || result.encode() != bytes {
            return Err("envelope-invalid");
        }
        Ok(result)
    }
    fn decrypt(&self, key: &Secret) -> Result<()> {
        let answer = gcm(
            key,
            &self.nonce,
            self.header().as_bytes(),
            &self.cipher,
            &mut self.tag.clone(),
            true,
        )?;
        if answer.0 != FIXTURE {
            return Err("fictional-record-mismatch");
        }
        Ok(()) // Plaintext never leaves this function.
    }
    fn silent(&self) -> Result<()> {
        check_separate_process_silent(&RestartState {
            name: self.name.clone(),
            cipher: self.wrapped.clone(),
            digest: [0; 32],
            uptime_ms: 0,
            boot_time_ticks: Some(self.boot),
        })
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Fault {
    None,
    PartialDiskFull,
    BeforeRename,
    LostReceipt,
}
fn atomic_commit(path: &Path, bytes: &[u8], replace: bool, fault: Fault) -> Result<()> {
    // Unique sibling, create-new and no cross-volume copy. A crash can leave only
    // ciphertext in a .pending file; readers never promote or replay that file.
    let pending = path.with_file_name(format!("fictional-{}.pending", hex(&random::<16>()?)));
    let mut owned = false;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending)
            .map_err(|_| "write-failed")?;
        owned = true;
        if fault == Fault::PartialDiskFull {
            file.write_all(&bytes[..bytes.len() / 2])
                .map_err(|_| "write-failed")?;
            return Err("injected-disk-full");
        }
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "write-failed")?;
        drop(file);
        if fault == Fault::BeforeRename {
            return Err("injected-interruption");
        }
        let source: Vec<u16> = pending.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let flags = if replace {
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
        } else {
            MOVEFILE_WRITE_THROUGH
        };
        unsafe { MoveFileExW(PCWSTR(source.as_ptr()), PCWSTR(target.as_ptr()), flags) }
            .map_err(|_| "commit-unknown-readback-required")?;
        if fault == Fault::LostReceipt {
            return Err("commit-unknown-readback-required");
        }
        if read_bytes(path)? != bytes {
            return Err("commit-unknown-readback-required");
        }
        Ok(())
    })();
    if owned && pending.exists() {
        fs::remove_file(&pending).map_err(|_| "pending-cleanup-failed")?;
    }
    result
}
fn read_bytes(path: &Path) -> Result<Vec<u8>> {
    use std::os::windows::fs::MetadataExt;
    let metadata = fs::symlink_metadata(path).map_err(|_| "envelope-unavailable")?;
    if !metadata.is_file() || metadata.file_attributes() & 0x400 != 0 || metadata.len() > MAX_FILE {
        return Err("envelope-invalid");
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "envelope-unavailable")?
        .take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "envelope-unavailable")?;
    if bytes.len() > MAX_FILE as usize {
        return Err("envelope-invalid");
    }
    Ok(bytes)
}
fn read(path: &Path) -> Result<Envelope> {
    Envelope::decode(&read_bytes(path)?)
}

fn create_key(hwnd: HWND, path: &Path) -> Result<(Provider, Key, String)> {
    let mut provider = NCRYPT_PROV_HANDLE(0);
    unsafe { NCryptOpenStorageProvider(&mut provider, MS_KEY_STORAGE_PROVIDER, 0) }
        .map_err(|_| "key-provider-unavailable")?;
    let provider = Provider(provider);
    let name = format!("LunaOSHome.FictionalKeyRelease.{}", hex(&random::<16>()?));
    // Save only the disposable key identifier before any OS prompt or key creation.
    // This permits owned cleanup after cancellation, window close or termination.
    let mut receipt = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path.with_file_name("fictional-protector.id"))
        .map_err(|_| "protector-receipt-exists-or-unavailable")?;
    receipt
        .write_all(name.as_bytes())
        .and_then(|_| receipt.sync_all())
        .map_err(|_| "protector-receipt-write-failed")?;
    drop(receipt);
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut handle = NCRYPT_KEY_HANDLE(0);
    unsafe {
        NCryptCreatePersistedKey(
            provider.0,
            &mut handle,
            NCRYPT_RSA_ALGORITHM,
            PCWSTR(wide.as_ptr()),
            CERT_KEY_SPEC(1),
            NCRYPT_FLAGS(0),
        )
    }
    .map_err(|_| "key-create-failed")?;
    let mut key = Key(handle);
    let configured = (|| {
        property(&key, NCRYPT_LENGTH_PROPERTY, &2048u32)?;
        property(&key, NCRYPT_KEY_USAGE_PROPERTY, &NCRYPT_ALLOW_DECRYPT_FLAG)?;
        property(&key, NCRYPT_WINDOW_HANDLE_PROPERTY, &(hwnd.0 as usize))?;
        property(&key, NCRYPT_UI_POLICY_PROPERTY, &NCRYPT_UI_POLICY {
            dwVersion: 1, dwFlags: NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG,
            pszCreationTitle: w!("Home fictional envelope"), pszFriendlyName: w!("Home disposable key password"),
            pszDescription: w!("Fictional test only. Use a separate disposable key password, not your Windows password."),
        })?;
        unsafe { NCryptFinalizeKey(key.0, NCRYPT_FLAGS(0)) }.map_err(|_| "key-creation-denied")
    })();
    if let Err(error) = configured {
        if !key.delete() {
            return Err("key-cleanup-required");
        }
        return Err(error);
    }
    Ok((provider, key, name))
}
fn foreground(hwnd: HWND, start: Instant) -> Result<()> {
    if start.elapsed() > Duration::from_secs(5) || unsafe { GetForegroundWindow() } != hwnd {
        return Err("foreground-visit-ended");
    }
    Ok(())
}
#[derive(Debug, PartialEq)]
enum ForegroundReturn {
    Waiting,
    Ready,
    Expired,
}
fn foreground_return(elapsed: Duration, owner_foreground: bool) -> ForegroundReturn {
    if elapsed >= Duration::from_millis(500) {
        ForegroundReturn::Expired
    } else if owner_foreground {
        ForegroundReturn::Ready
    } else {
        ForegroundReturn::Waiting
    }
}
fn await_foreground(hwnd: HWND) -> Result<()> {
    // NCrypt runs on a worker. Its dialog can return before the owner UI thread
    // processes activation. No record operation is allowed during this interval;
    // never force focus or accept a different foreground window.
    let start = Instant::now();
    loop {
        match foreground_return(start.elapsed(), unsafe { GetForegroundWindow() } == hwnd) {
            ForegroundReturn::Ready => {
                KEY_FOREGROUND.store(true, Ordering::SeqCst);
                return Ok(());
            }
            ForegroundReturn::Expired => return Err("foreground-return-expired"),
            ForegroundReturn::Waiting => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}
fn unwrap(envelope: &Envelope, hwnd: HWND) -> Result<()> {
    envelope.silent()?;
    let (_provider, key) = open_software_key(&envelope.name)?;
    property(&key, NCRYPT_WINDOW_HANDLE_PROPERTY, &(hwnd.0 as usize))?;
    let secret =
        Secret(crypt(&key, &envelope.wrapped, true, false).map_err(|_| "os-key-release-denied")?);
    let active = ActiveKey::begin();
    println!("envelope-stage: os-key-released");
    await_foreground(hwnd)?;
    // No key-bearing session is retained while waiting for terminal input.
    let start = Instant::now();
    foreground(hwnd, start)?;
    envelope.decrypt(&secret)?;
    foreground(hwnd, start)?;
    drop(secret);
    drop(active);
    drop(key);
    envelope.silent()?;
    Ok(())
}
fn prepare(path: &Path, hwnd: HWND) -> Result<()> {
    if path.exists() {
        return Err("envelope-already-exists");
    }
    let boot = current_boot_time()?;
    let (_provider, mut protector, name) = create_key(hwnd, path)?;
    println!("envelope-stage: protector-created");
    let result = (|| {
        let active = ActiveKey::begin();
        await_foreground(hwnd)?;
        let secret = data_key()?;
        let mut envelope = Envelope {
            name: name.clone(),
            boot,
            wrapped: crypt(&protector, &secret.0, false, true).map_err(|_| "wrap-failed")?,
            nonce: random::<12>()?,
            cipher: Vec::new(),
            tag: [0; 16],
        };
        envelope.cipher = gcm(
            &secret,
            &envelope.nonce,
            envelope.header().as_bytes(),
            FIXTURE,
            &mut envelope.tag,
            false,
        )?
        .0
        .clone();
        drop(secret);
        drop(active);
        unwrap(&envelope, hwnd)?;
        atomic_commit(path, &envelope.encode(), false, Fault::None)?;
        println!("fictional-envelope-prepared-locked");
        Ok(())
    })();
    // Retain the protector on an uncertain receipt if a committed file exists.
    if result.is_err() && !path.exists() && !protector.delete() {
        return Err("key-cleanup-required");
    }
    result
}

// Native owner window; session/power/window events and a 120-second watchdog
// terminate this isolated process, including a blocked prompt. Process teardown
// is the hard lifetime boundary; no key is returned to Home.
fn visit(operation: impl FnOnce(HWND) -> Result<()> + Send + 'static) -> Result<()> {
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("STATIC"),
            w!("Home fictional key test - close to end"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            640,
            180,
            None,
            None,
            None,
            None,
        )
    }
    .map_err(|_| "visit-window-unavailable")?;
    let _monitor = session::install(hwnd, || std::process::exit(3))
        .map_err(|_| "visit-monitor-unavailable")?;
    unsafe {
        let _ = SetForegroundWindow(hwnd);
    }
    let address = hwnd.0 as usize;
    let worker = std::thread::spawn(move || operation(HWND(address as *mut _)));
    let start = Instant::now();
    let mut key_start = None;
    while !worker.is_finished() {
        if start.elapsed() > Duration::from_secs(120) || !unsafe { IsWindow(Some(hwnd)) }.as_bool()
        {
            std::process::exit(3);
        }
        if KEY_ACTIVE.load(Ordering::SeqCst) {
            let since = key_start.get_or_insert_with(Instant::now);
            if since.elapsed() > Duration::from_secs(5)
                || (KEY_FOREGROUND.load(Ordering::SeqCst)
                    && unsafe { GetForegroundWindow() } != hwnd)
            {
                std::process::exit(3);
            }
        } else {
            key_start = None;
        }
        let mut msg = MSG::default();
        unsafe {
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_QUIT {
                    std::process::exit(3);
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let result = worker.join().map_err(|_| "visit-worker-failed")?;
    unsafe {
        let _ = DestroyWindow(hwnd);
    }
    result
}

pub(super) fn run(arguments: &[String]) -> Result<()> {
    let [mode, file] = arguments else {
        return Err("envelope-arguments-invalid");
    };
    let path = std::path::PathBuf::from(file);
    validate_restart_path(&path)?;
    if path.file_name().and_then(|p| p.to_str()) != Some("fictional-envelope.v1") {
        return Err("envelope-path-invalid");
    }
    // Serialize all operations, including cleanup, across native processes.
    use std::os::windows::fs::OpenOptionsExt;
    let _lease = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(path.with_file_name("fictional-envelope.lock"))
        .map_err(|_| "envelope-busy-or-unavailable")?;
    match mode.as_str() {
        "--envelope-attended-prepare" => visit(move |hwnd| prepare(&path, hwnd)),
        "--envelope-attended-read" | "--envelope-attended-verify-restart" => {
            let envelope = read(&path)?;
            if mode.ends_with("verify-restart")
                && !cold_restart_observed(envelope.boot, current_boot_time()?)
            {
                return Err("cold-restart-not-observed");
            }
            visit(move |hwnd| unwrap(&envelope, hwnd))
        }
        "--envelope-check-locked" => {
            read(&path)?.silent()?;
            println!("fresh-process-silent-decrypt-denied");
            Ok(())
        }
        "--envelope-cleanup" => {
            cleanup(&path)?;
            println!("disposable-key-and-envelope-removed");
            Ok(())
        }
        _ => Err("envelope-arguments-invalid"),
    }
}

fn cleanup(path: &Path) -> Result<()> {
    let receipt = path.with_file_name("fictional-protector.id");
    let bytes = read_bytes(&receipt)?;
    let name = std::str::from_utf8(&bytes).map_err(|_| "protector-receipt-invalid")?;
    if name.len() != 63
        || !name.starts_with("LunaOSHome.FictionalKeyRelease.")
        || !name[31..].bytes().all(|v| v.is_ascii_hexdigit())
    {
        return Err("protector-receipt-invalid");
    }
    // Only a documented missing-key result is idempotent cleanup. Provider/access
    // failures preserve both files for explicit repair; they are not deletion.
    let mut provider = NCRYPT_PROV_HANDLE(0);
    unsafe { NCryptOpenStorageProvider(&mut provider, MS_KEY_STORAGE_PROVIDER, 0) }
        .map_err(|_| "key-provider-unavailable")?;
    let provider = Provider(provider);
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut handle = NCRYPT_KEY_HANDLE(0);
    match unsafe {
        NCryptOpenKey(
            provider.0,
            &mut handle,
            PCWSTR(wide.as_ptr()),
            CERT_KEY_SPEC(1),
            NCRYPT_SILENT_FLAG,
        )
    } {
        Ok(()) => {
            if !Key(handle).delete() {
                return Err("key-cleanup-required");
            }
        }
        Err(error) if error.code().0 as u32 == 0x80090016 => {} // NTE_BAD_KEYSET
        Err(_) => return Err("key-cleanup-required"),
    }
    if path.exists() {
        fs::remove_file(path).map_err(|_| "envelope-cleanup-required")?;
    }
    fs::remove_file(receipt).map_err(|_| "protector-receipt-cleanup-required")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> (Envelope, Secret) {
        let key = data_key().unwrap();
        let mut envelope = Envelope {
            name: format!("LunaOSHome.FictionalKeyRelease.{}", "a".repeat(32)),
            boot: 638_000_000_000_000_000,
            wrapped: vec![7; 256],
            nonce: random::<12>().unwrap(),
            cipher: vec![],
            tag: [0; 16],
        };
        envelope.cipher = gcm(
            &key,
            &envelope.nonce,
            envelope.header().as_bytes(),
            FIXTURE,
            &mut envelope.tag,
            false,
        )
        .unwrap()
        .0
        .clone();
        (envelope, key)
    }
    #[test]
    fn cng_aes256_gcm_known_answer() {
        let key = Secret(vec![0; 32]);
        let mut tag = [0; 16];
        let cipher = gcm(&key, &[0; 12], b"", &[0; 16], &mut tag, false).unwrap();
        assert_eq!(hex(&cipher.0), "cea7403d4d606b6e074ec5d3baf39d18");
        assert_eq!(hex(&tag), "d0d1c8a799996bf0265b98b5d48ab919");
        assert_eq!(
            gcm(&key, &[0; 12], b"", &cipher.0, &mut tag, true)
                .unwrap()
                .0,
            [0; 16]
        );
    }

    #[test]
    fn ephemeral_software_rsa_wraps_native_envelope_key_and_rejects_tamper() {
        // Unnamed, unprotected, nonpersistent test key: never authentication evidence.
        let mut provider = NCRYPT_PROV_HANDLE(0);
        unsafe { NCryptOpenStorageProvider(&mut provider, MS_KEY_STORAGE_PROVIDER, 0) }.unwrap();
        let provider = Provider(provider);
        let mut handle = NCRYPT_KEY_HANDLE(0);
        unsafe {
            NCryptCreatePersistedKey(
                provider.0,
                &mut handle,
                NCRYPT_RSA_ALGORITHM,
                PCWSTR::null(),
                CERT_KEY_SPEC(1),
                NCRYPT_FLAGS(0),
            )
        }
        .unwrap();
        let key = Key(handle);
        property(&key, NCRYPT_LENGTH_PROPERTY, &2048u32).unwrap();
        unsafe { NCryptFinalizeKey(key.0, NCRYPT_SILENT_FLAG) }.unwrap();
        let (mut envelope, secret) = sample();
        envelope.wrapped = crypt(&key, &secret.0, false, true).unwrap();
        envelope.nonce = random::<12>().unwrap();
        envelope.cipher = gcm(
            &secret,
            &envelope.nonce,
            envelope.header().as_bytes(),
            FIXTURE,
            &mut envelope.tag,
            false,
        )
        .unwrap()
        .0
        .clone();
        let unwrapped = Secret(crypt(&key, &envelope.wrapped, true, true).unwrap());
        envelope.decrypt(&unwrapped).unwrap();
        envelope.wrapped[0] ^= 1;
        assert!(crypt(&key, &envelope.wrapped, true, true).is_err());
    }
    #[test]
    fn authenticated_header_cipher_tag_and_wrong_key_fail_closed() {
        let (original, key) = sample();
        original.decrypt(&key).unwrap();
        for field in 0..6 {
            let mut altered = original.clone();
            match field {
                0 => altered.boot += 1,
                1 => altered.name.replace_range(31..32, "b"),
                2 => altered.wrapped[0] ^= 1,
                3 => altered.nonce[0] ^= 1,
                4 => altered.cipher[0] ^= 1,
                _ => altered.tag[0] ^= 1,
            }
            assert!(altered.decrypt(&key).is_err());
        }
        assert!(original.decrypt(&data_key().unwrap()).is_err());
        assert!(original.decrypt(&Secret(vec![0; 31])).is_err());
    }
    #[test]
    fn envelope_parser_is_bounded_canonical_and_versioned() {
        let (envelope, _) = sample();
        let bytes = envelope.encode();
        assert_eq!(Envelope::decode(&bytes).unwrap().encode(), bytes);
        for index in 0..bytes.len() {
            let mut broken = bytes.clone();
            broken[index] = 0xff;
            assert!(Envelope::decode(&broken).is_err());
        }
        assert!(Envelope::decode(&vec![0; 8193]).is_err());
        assert!(Envelope::decode(&bytes[..bytes.len() - 1]).is_err());
        let text = String::from_utf8(bytes).unwrap();
        assert!(Envelope::decode(
            text.replace(MAGIC, "LunaOSHome.FictionalEnvelope.2")
                .as_bytes()
        )
        .is_err());
        assert!(Envelope::decode(
            text.replace("638000000000000000", "0638000000000000000")
                .as_bytes()
        )
        .is_err());
        assert!(unhex("éé").is_none());
    }
    #[test]
    fn interrupted_partial_full_disk_and_lost_receipt_preserve_atomic_boundary() {
        let directory = std::env::temp_dir().join(format!(
            "HomeFictionalEnvelopeTest-{}",
            hex(&random::<16>().unwrap())
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("fictional-envelope.v1");
        let (old, key) = sample();
        let (new, _) = sample();
        atomic_commit(&path, &old.encode(), false, Fault::None).unwrap();
        for fault in [Fault::PartialDiskFull, Fault::BeforeRename] {
            assert!(atomic_commit(&path, &new.encode(), true, fault).is_err());
            assert_eq!(read_bytes(&path).unwrap(), old.encode());
            read(&path).unwrap().decrypt(&key).unwrap();
            assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        }
        assert!(atomic_commit(&path, &new.encode(), false, Fault::None).is_err());
        assert_eq!(read_bytes(&path).unwrap(), old.encode());
        assert!(atomic_commit(&path, &new.encode(), true, Fault::LostReceipt).is_err());
        assert_eq!(read_bytes(&path).unwrap(), new.encode());
        let pending = directory.join("stale.pending");
        fs::write(&pending, &old.encode()[..100]).unwrap();
        assert_eq!(read(&path).unwrap().encode(), new.encode());
        fs::remove_file(pending).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn missing_protector_and_no_foreground_deny_without_prompt() {
        let name = format!(
            "LunaOSHome.FictionalKeyRelease.{}",
            hex(&random::<16>().unwrap())
        );
        assert!(open_software_key(&name).is_err());
        assert!(foreground(HWND::default(), Instant::now()).is_err());
        assert!(foreground(
            unsafe { GetForegroundWindow() },
            Instant::now() - Duration::from_secs(6)
        )
        .is_err());
    }
    #[test]
    fn owned_secret_wipe_clears_bytes() {
        let mut bytes = vec![17; 32];
        wipe(&mut bytes);
        assert_eq!(bytes, vec![0; 32]);
    }

    #[test]
    fn foreground_return_waits_for_activation_but_never_extends_deadline() {
        assert_eq!(
            foreground_return(Duration::ZERO, false),
            ForegroundReturn::Waiting
        );
        assert_eq!(
            foreground_return(Duration::from_millis(10), false),
            ForegroundReturn::Waiting
        );
        assert_eq!(
            foreground_return(Duration::from_millis(20), true),
            ForegroundReturn::Ready
        );
        for focused in [false, true] {
            assert_eq!(
                foreground_return(Duration::from_millis(500), focused),
                ForegroundReturn::Expired
            );
        }
    }

    #[test]
    fn aborted_preparation_receipt_cleans_up_without_any_key_or_envelope() {
        let directory = std::env::temp_dir().join(format!(
            "HomeFictionalCleanupTest-{}",
            hex(&random::<16>().unwrap())
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("fictional-envelope.v1");
        let receipt = directory.join("fictional-protector.id");
        let name = format!(
            "LunaOSHome.FictionalKeyRelease.{}",
            hex(&random::<16>().unwrap())
        );
        fs::write(&receipt, name).unwrap();
        cleanup(&path).unwrap();
        assert!(!receipt.exists());
        fs::write(&receipt, b"unrelated-key").unwrap();
        assert!(cleanup(&path).is_err());
        assert!(receipt.exists());
        fs::remove_file(receipt).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn same_boot_envelope_verification_refuses_before_native_window_or_key_open() {
        let root = Path::new(&std::env::var_os("LOCALAPPDATA").unwrap())
            .join("LunaOSHome")
            .join("AttendedEvidence");
        fs::create_dir_all(&root).unwrap();
        let directory = root.join(format!("unattended-{}", hex(&random::<16>().unwrap())));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("fictional-envelope.v1");
        let (mut envelope, _) = sample();
        // No persisted protector is created. The boot check must precede all
        // key access, UI, and authentication; this is not a cold-restart result.
        envelope.boot = current_boot_time().unwrap();
        fs::write(&path, envelope.encode()).unwrap();
        assert_eq!(
            run(&[
                "--envelope-attended-verify-restart".into(),
                path.to_str().unwrap().into()
            ]),
            Err("cold-restart-not-observed")
        );
        assert_eq!(read_bytes(&path).unwrap(), envelope.encode());
        fs::remove_file(path).unwrap();
        fs::remove_file(directory.join("fictional-envelope.lock")).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
