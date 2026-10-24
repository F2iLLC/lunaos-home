//! Disposable Windows-only key-release feasibility probe. No vault adapter or JS path.
//! It prints stage outcomes only; the random test key and Windows input never leave memory.
#![cfg(target_os = "windows")]
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::mem::size_of;
use std::path::Path;
use std::process::{Command, Stdio};
use windows::core::{w, PCWSTR};
use windows::Win32::Security::Cryptography::{
    BCryptCloseAlgorithmProvider, BCryptGenRandom, BCryptHash, BCryptOpenAlgorithmProvider,
    NCryptCreatePersistedKey, NCryptDecrypt, NCryptDeleteKey, NCryptEncrypt, NCryptFinalizeKey,
    NCryptFreeObject, NCryptOpenKey, NCryptOpenStorageProvider, NCryptSetProperty,
    BCRYPT_ALG_HANDLE, BCRYPT_OAEP_PADDING_INFO, BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS,
    BCRYPT_SHA256_ALGORITHM, BCRYPT_USE_SYSTEM_PREFERRED_RNG, CERT_KEY_SPEC,
    MS_KEY_STORAGE_PROVIDER, MS_NGC_KEY_STORAGE_PROVIDER, NCRYPT_ALLOW_DECRYPT_FLAG, NCRYPT_FLAGS,
    NCRYPT_KEY_HANDLE, NCRYPT_KEY_USAGE_PROPERTY, NCRYPT_PAD_OAEP_FLAG, NCRYPT_PROV_HANDLE,
    NCRYPT_RSA_ALGORITHM, NCRYPT_SILENT_FLAG, NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG,
    NCRYPT_UI_POLICY, NCRYPT_UI_POLICY_PROPERTY,
};
use windows::Win32::System::SystemInformation::GetTickCount64;

struct Provider(NCRYPT_PROV_HANDLE);
impl Drop for Provider {
    fn drop(&mut self) {
        unsafe {
            let _ = NCryptFreeObject(self.0.into());
        }
    }
}
struct Key(NCRYPT_KEY_HANDLE);
impl Key {
    fn delete(&mut self) -> bool {
        let result = unsafe { NCryptDeleteKey(self.0, 0) }.is_ok();
        if result {
            self.0 = NCRYPT_KEY_HANDLE(0);
        }
        result
    }
}
impl Drop for Key {
    fn drop(&mut self) {
        if self.0 .0 != 0 {
            unsafe {
                let _ = NCryptFreeObject(self.0.into());
            }
        }
    }
}
fn random<const N: usize>() -> Result<[u8; N], &'static str> {
    let mut value = [0u8; N];
    let result = unsafe { BCryptGenRandom(None, &mut value, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if result.0 < 0 {
        return Err("random-unavailable");
    }
    Ok(value)
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn unhex(value: &str) -> Option<Vec<u8>> {
    if value.len() > 16384 || value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|offset| u8::from_str_radix(&value[offset..offset + 2], 16).ok())
        .collect()
}

fn sha256(value: &[u8]) -> Result<[u8; 32], &'static str> {
    let mut algorithm = BCRYPT_ALG_HANDLE(std::ptr::null_mut());
    if unsafe {
        BCryptOpenAlgorithmProvider(
            &mut algorithm,
            BCRYPT_SHA256_ALGORITHM,
            PCWSTR::null(),
            BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS(0),
        )
    }
    .0 < 0
    {
        return Err("digest-unavailable");
    }
    let mut digest = [0u8; 32];
    let result = unsafe { BCryptHash(algorithm, None, value, &mut digest) };
    let _ = unsafe { BCryptCloseAlgorithmProvider(algorithm, 0) };
    if result.0 < 0 {
        return Err("digest-unavailable");
    }
    Ok(digest)
}

struct RestartState {
    name: String,
    cipher: Vec<u8>,
    digest: [u8; 32],
    uptime_ms: u64,
}

impl RestartState {
    fn encode(&self) -> String {
        format!(
            "1\n{}\n{}\n{}\n{}\n",
            self.name,
            hex(&self.cipher),
            hex(&self.digest),
            self.uptime_ms
        )
    }

    fn decode(content: &str) -> Result<Self, &'static str> {
        if content.len() > 8192 || !content.ends_with('\n') {
            return Err("restart-state-invalid");
        }
        let mut lines = content.lines();
        if lines.next() != Some("1") {
            return Err("restart-state-invalid");
        }
        let name = lines.next().ok_or("restart-state-invalid")?;
        if !name.starts_with("LunaOSHome.FictionalKeyRelease.")
            || name.len() != 63
            || !name[31..].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("restart-state-invalid");
        }
        let cipher =
            unhex(lines.next().ok_or("restart-state-invalid")?).ok_or("restart-state-invalid")?;
        if cipher.len() < 128 || cipher.len() > 8192 {
            return Err("restart-state-invalid");
        }
        let digest: [u8; 32] = unhex(lines.next().ok_or("restart-state-invalid")?)
            .ok_or("restart-state-invalid")?
            .try_into()
            .map_err(|_| "restart-state-invalid")?;
        let uptime_ms = lines
            .next()
            .ok_or("restart-state-invalid")?
            .parse::<u64>()
            .map_err(|_| "restart-state-invalid")?;
        if uptime_ms == 0 || lines.next().is_some() {
            return Err("restart-state-invalid");
        }
        Ok(Self {
            name: name.to_owned(),
            cipher,
            digest,
            uptime_ms,
        })
    }
}

fn write_restart_state(path: &Path, state: &RestartState) -> Result<(), &'static str> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "restart-state-create-failed")?;
    if file.write_all(state.encode().as_bytes()).is_err() || file.sync_all().is_err() {
        let _ = fs::remove_file(path);
        return Err("restart-state-write-failed");
    }
    Ok(())
}
fn property<T>(key: &Key, name: PCWSTR, value: &T) -> Result<(), &'static str> {
    let bytes =
        unsafe { std::slice::from_raw_parts(value as *const T as *const u8, size_of::<T>()) };
    unsafe { NCryptSetProperty(key.0.into(), name, bytes, NCRYPT_FLAGS(0)) }
        .map_err(|_| "key-policy-unavailable")
}
fn crypt(key: &Key, input: &[u8], decrypt: bool, silent: bool) -> Result<Vec<u8>, ()> {
    let padding = BCRYPT_OAEP_PADDING_INFO {
        pszAlgId: BCRYPT_SHA256_ALGORITHM,
        pbLabel: std::ptr::null_mut(),
        cbLabel: 0,
    };
    let info = &padding as *const _ as *const std::ffi::c_void;
    let flags =
        NCRYPT_FLAGS(NCRYPT_PAD_OAEP_FLAG.0 | if silent { NCRYPT_SILENT_FLAG.0 } else { 0 });
    let call = |output: Option<&mut [u8]>, count: &mut u32| unsafe {
        if decrypt {
            NCryptDecrypt(key.0, Some(input), Some(info), output, count, flags)
        } else {
            NCryptEncrypt(key.0, Some(input), Some(info), output, count, flags)
        }
    };
    let mut size = 0u32;
    call(None, &mut size).map_err(|_| ())?;
    if size == 0 || size > 8192 {
        return Err(());
    }
    let mut output = vec![0u8; size as usize];
    call(Some(&mut output), &mut size).map_err(|_| ())?;
    if size as usize > output.len() {
        return Err(());
    }
    output.truncate(size as usize);
    Ok(output)
}
fn provider_name(passport: bool) -> PCWSTR {
    if passport {
        MS_NGC_KEY_STORAGE_PROVIDER
    } else {
        MS_KEY_STORAGE_PROVIDER
    }
}
fn silent_child(passport: bool, name: &str, cipher: &str) -> i32 {
    let Some(cipher) = unhex(cipher) else {
        return 2;
    };
    let mut provider = NCRYPT_PROV_HANDLE(0);
    if unsafe { NCryptOpenStorageProvider(&mut provider, provider_name(passport), 0) }.is_err() {
        return 2;
    }
    let provider = Provider(provider);
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut handle = NCRYPT_KEY_HANDLE(0);
    if unsafe {
        NCryptOpenKey(
            provider.0,
            &mut handle,
            PCWSTR::from_raw(wide.as_ptr()),
            CERT_KEY_SPEC(1),
            NCRYPT_FLAGS(0),
        )
    }
    .is_err()
    {
        return 2;
    }
    let key = Key(handle);
    match crypt(&key, &cipher, true, true) {
        Ok(mut exposed) => {
            exposed.fill(0);
            0
        }
        Err(()) => 3,
    }
}
fn probe(passport: bool, restart_state: Option<&Path>) -> Result<(), &'static str> {
    let mut provider = NCRYPT_PROV_HANDLE(0);
    unsafe { NCryptOpenStorageProvider(&mut provider, provider_name(passport), 0) }
        .map_err(|_| "key-provider-unavailable")?;
    let provider = Provider(provider);
    let id = random::<16>()?;
    let name_text = format!("LunaOSHome.FictionalKeyRelease.{}", hex(&id));
    let wide: Vec<u16> = name_text.encode_utf16().chain(std::iter::once(0)).collect();
    let name = PCWSTR::from_raw(wide.as_ptr());
    let mut handle = NCRYPT_KEY_HANDLE(0);
    unsafe {
        NCryptCreatePersistedKey(
            provider.0,
            &mut handle,
            NCRYPT_RSA_ALGORITHM,
            name,
            CERT_KEY_SPEC(1),
            NCRYPT_FLAGS(0),
        )
    }
    .map_err(|error| {
        eprintln!("key-create-status: 0x{:08x}", error.code().0 as u32);
        "key-create-failed"
    })?;
    let mut key = Some(Key(handle));
    let result = (|| {
        let policy = NCRYPT_UI_POLICY {
            dwVersion: 1,
            dwFlags: NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG,
            pszCreationTitle: w!("Luna OS Home fictional key test"),
            pszFriendlyName: w!("Luna OS Home fictional key test"),
            pszDescription: w!("Disposable authentication-bound key probe"),
        };
        property(key.as_ref().unwrap(), NCRYPT_UI_POLICY_PROPERTY, &policy)?;
        property(
            key.as_ref().unwrap(),
            NCRYPT_KEY_USAGE_PROPERTY,
            &NCRYPT_ALLOW_DECRYPT_FLAG,
        )?;
        unsafe { NCryptFinalizeKey(key.as_ref().unwrap().0, NCRYPT_FLAGS(0)) }
            .map_err(|_| "key-finalize-failed")?;
        println!("created-protected-key");
        let mut fixture = random::<32>()?;
        let digest = restart_state.map(|_| sha256(&fixture)).transpose()?;
        let cipher = crypt(key.as_ref().unwrap(), &fixture, false, true)
            .map_err(|_| "public-wrap-failed")?;
        key.take(); // Close the private-key handle before reopening the persisted key.
        let check_child = || {
            Command::new(std::env::current_exe().map_err(|_| "probe-child-unavailable")?)
                .args([
                    "--silent-existing",
                    if passport { "passport" } else { "software" },
                    &name_text,
                    &hex(&cipher),
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|_| "probe-child-unavailable")
        };
        let status = check_child()?;
        if status.code() == Some(0) {
            fixture.fill(0);
            return Err("silent-decrypt-succeeded-in-separate-process");
        }
        if status.code() != Some(3) {
            fixture.fill(0);
            return Err("silent-child-inconclusive");
        }
        println!("separate-process-silent-decrypt-denied");
        let mut reopened = NCRYPT_KEY_HANDLE(0);
        unsafe {
            NCryptOpenKey(
                provider.0,
                &mut reopened,
                name,
                CERT_KEY_SPEC(1),
                NCRYPT_FLAGS(0),
            )
        }
        .map_err(|_| "key-reopen-failed")?;
        key = Some(Key(reopened));
        println!("reopened-key");
        let answer = crypt(key.as_ref().unwrap(), &cipher, true, false)
            .map_err(|_| "attended-decrypt-failed")?;
        let same = answer == fixture;
        let mut answer = answer;
        answer.fill(0);
        fixture.fill(0);
        if !same {
            return Err("decrypted-key-mismatch");
        }
        println!("attended-decrypt-matched");
        let after_prompt = check_child()?;
        if after_prompt.code() == Some(0) {
            return Err("silent-decrypt-succeeded-after-prompt");
        }
        if after_prompt.code() != Some(3) {
            return Err("post-prompt-child-inconclusive");
        }
        println!("post-prompt-separate-process-silent-decrypt-denied");
        if let (Some(path), Some(digest)) = (restart_state, digest) {
            write_restart_state(
                path,
                &RestartState {
                    name: name_text.clone(),
                    cipher,
                    digest,
                    uptime_ms: unsafe { GetTickCount64() },
                },
            )?;
            println!("restart-state-prepared");
        }
        Ok(())
    })();
    if result.is_ok() && restart_state.is_some() {
        println!("probe-key-retained-for-restart");
        return result;
    }
    if key.is_none() {
        let mut reopened = NCRYPT_KEY_HANDLE(0);
        if unsafe {
            NCryptOpenKey(
                provider.0,
                &mut reopened,
                name,
                CERT_KEY_SPEC(1),
                NCRYPT_FLAGS(0),
            )
        }
        .is_ok()
        {
            key = Some(Key(reopened));
        }
    }
    if !key.as_mut().is_some_and(Key::delete) {
        return Err("probe-key-cleanup-failed");
    }
    println!("probe-key-removed");
    result
}

fn validate_restart_path(path: &Path) -> Result<(), &'static str> {
    if !path.is_absolute() {
        return Err("restart-state-path-invalid");
    }
    let root = Path::new(&std::env::var_os("LOCALAPPDATA").ok_or("restart-state-path-invalid")?)
        .join("LunaOSHome")
        .join("AttendedEvidence")
        .canonicalize()
        .map_err(|_| "restart-state-path-invalid")?;
    let parent = path
        .parent()
        .ok_or("restart-state-path-invalid")?
        .canonicalize()
        .map_err(|_| "restart-state-path-invalid")?;
    if !parent.starts_with(root) {
        return Err("restart-state-path-invalid");
    }
    Ok(())
}

fn read_restart_state(path: &Path) -> Result<RestartState, &'static str> {
    validate_restart_path(path)?;
    if fs::symlink_metadata(path)
        .map_err(|_| "restart-state-unavailable")?
        .file_type()
        .is_symlink()
    {
        return Err("restart-state-invalid");
    }
    RestartState::decode(&fs::read_to_string(path).map_err(|_| "restart-state-unavailable")?)
}

fn open_software_key(name: &str) -> Result<(Provider, Key), &'static str> {
    let mut provider = NCRYPT_PROV_HANDLE(0);
    unsafe { NCryptOpenStorageProvider(&mut provider, MS_KEY_STORAGE_PROVIDER, 0) }
        .map_err(|_| "key-provider-unavailable")?;
    let provider = Provider(provider);
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut handle = NCRYPT_KEY_HANDLE(0);
    unsafe {
        NCryptOpenKey(
            provider.0,
            &mut handle,
            PCWSTR::from_raw(wide.as_ptr()),
            CERT_KEY_SPEC(1),
            NCRYPT_FLAGS(0),
        )
    }
    .map_err(|_| "key-reopen-failed")?;
    Ok((provider, Key(handle)))
}

fn check_separate_process_silent(state: &RestartState) -> Result<(), &'static str> {
    let status = Command::new(std::env::current_exe().map_err(|_| "probe-child-unavailable")?)
        .args([
            "--silent-existing",
            "software",
            &state.name,
            &hex(&state.cipher),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "probe-child-unavailable")?;
    match status.code() {
        Some(3) => Ok(()),
        Some(0) => Err("silent-decrypt-succeeded-in-separate-process"),
        _ => Err("silent-child-inconclusive"),
    }
}

fn verify_restart(path: &Path) -> Result<(), &'static str> {
    let state = read_restart_state(path)?;
    let current_uptime_ms = unsafe { GetTickCount64() };
    if !cold_restart_observed(state.uptime_ms, current_uptime_ms) {
        return Err("cold-restart-not-observed");
    }
    println!("cold-restart-observed");
    check_separate_process_silent(&state)?;
    println!("post-restart-separate-process-silent-decrypt-denied");
    let (_provider, mut key) = open_software_key(&state.name)?;
    let mut answer = crypt(&key, &state.cipher, true, false)
        .map_err(|_| "post-restart-attended-decrypt-failed")?;
    let digest = sha256(&answer);
    answer.fill(0);
    if digest? != state.digest {
        return Err("post-restart-decrypted-key-mismatch");
    }
    println!("post-restart-attended-decrypt-matched");
    check_separate_process_silent(&state)?;
    println!("post-restart-post-prompt-silent-decrypt-denied");
    if !key.delete() {
        return Err("probe-key-cleanup-failed");
    }
    println!("probe-key-removed");
    fs::remove_file(path).map_err(|_| "restart-state-cleanup-failed")?;
    println!("restart-state-removed");
    Ok(())
}

fn cold_restart_observed(before_ms: u64, after_ms: u64) -> bool {
    after_ms.saturating_add(60_000) < before_ms
}

fn cleanup_restart(path: &Path) -> Result<(), &'static str> {
    let state = read_restart_state(path)?;
    let (_provider, mut key) = open_software_key(&state.name)?;
    if !key.delete() {
        return Err("probe-key-cleanup-failed");
    }
    println!("probe-key-removed");
    fs::remove_file(path).map_err(|_| "restart-state-cleanup-failed")?;
    println!("restart-state-removed");
    Ok(())
}
fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if let [mode, provider, name, cipher] = arguments.as_slice() {
        if mode == "--silent-existing" && name.starts_with("LunaOSHome.FictionalKeyRelease.") {
            let passport = provider == "passport";
            if passport || provider == "software" {
                std::process::exit(silent_child(passport, name, cipher));
            }
        }
    }
    if let [mode, provider, file] = arguments.as_slice() {
        if provider == "software"
            && matches!(
                mode.as_str(),
                "--attended-prepare-restart"
                    | "--attended-verify-restart"
                    | "--attended-cleanup-restart"
            )
        {
            let path = Path::new(file);
            let result = validate_restart_path(path).and_then(|_| match mode.as_str() {
                "--attended-prepare-restart" if path.exists() => {
                    Err("restart-state-already-exists")
                }
                "--attended-prepare-restart" => probe(false, Some(path)),
                "--attended-verify-restart" => verify_restart(path),
                _ => cleanup_restart(path),
            });
            match result {
                Ok(()) => println!(
                    "probe-result: {}",
                    if mode == "--attended-prepare-restart" {
                        "prepared-for-cold-restart"
                    } else if mode == "--attended-verify-restart" {
                        "cold-restart-roundtrip-only"
                    } else {
                        "disposable-state-cleaned"
                    }
                ),
                Err(stage) => {
                    eprintln!("probe-result: {stage}");
                    std::process::exit(1);
                }
            }
            return;
        }
    }
    let passport = match arguments.as_slice() {
        [attended, provider] if attended == "--attended" && provider == "passport" => true,
        [attended, provider] if attended == "--attended" && provider == "software" => false,
        _ => {
            eprintln!("Pass --attended passport/software or an attended software restart mode with an external state file.");
            std::process::exit(2);
        }
    };
    match probe(passport, None) {
        Ok(()) => println!("probe-result: cryptographic-roundtrip-only"),
        Err(stage) => {
            eprintln!("probe-result: {stage}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{cold_restart_observed, RestartState};

    #[test]
    fn restart_state_round_trip_and_rejects_malformed_input() {
        let state = RestartState {
            name: format!("LunaOSHome.FictionalKeyRelease.{}", "a".repeat(32)),
            cipher: vec![7; 256],
            digest: [9; 32],
            uptime_ms: 600_000,
        };
        let encoded = state.encode();
        let decoded = RestartState::decode(&encoded).unwrap();
        assert_eq!(decoded.name, state.name);
        assert_eq!(decoded.cipher, state.cipher);
        assert_eq!(decoded.digest, state.digest);
        assert_eq!(decoded.uptime_ms, state.uptime_ms);
        assert!(RestartState::decode(&encoded.replace("LunaOSHome", "OtherHome")).is_err());
        assert!(RestartState::decode(&encoded.replace("600000\n", "0\n")).is_err());
        assert!(RestartState::decode(&format!("{encoded}extra\n")).is_err());
        assert!(RestartState::decode(encoded.trim_end()).is_err());
    }

    #[test]
    fn boot_guard_requires_a_decreased_uptime_with_margin() {
        assert!(!cold_restart_observed(600_000, 700_000));
        assert!(!cold_restart_observed(600_000, 550_000));
        assert!(cold_restart_observed(600_000, 60_000));
    }
}
