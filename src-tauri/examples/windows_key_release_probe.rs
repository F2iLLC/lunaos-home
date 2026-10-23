//! Disposable Windows-only key-release feasibility probe. No vault adapter or JS path.
//! It prints stage outcomes only; the random test key and Windows input never leave memory.
#![cfg(target_os = "windows")]
use std::mem::size_of;
use std::process::{Command, Stdio};
use windows::core::{w, PCWSTR};
use windows::Win32::Security::Cryptography::{
    BCryptGenRandom, NCryptCreatePersistedKey, NCryptDecrypt, NCryptDeleteKey, NCryptEncrypt,
    NCryptFinalizeKey, NCryptFreeObject, NCryptOpenKey, NCryptOpenStorageProvider,
    NCryptSetProperty, BCRYPT_OAEP_PADDING_INFO, BCRYPT_SHA256_ALGORITHM,
    BCRYPT_USE_SYSTEM_PREFERRED_RNG, CERT_KEY_SPEC, MS_KEY_STORAGE_PROVIDER,
    MS_NGC_KEY_STORAGE_PROVIDER, NCRYPT_ALLOW_DECRYPT_FLAG, NCRYPT_FLAGS, NCRYPT_KEY_HANDLE,
    NCRYPT_KEY_USAGE_PROPERTY, NCRYPT_PAD_OAEP_FLAG, NCRYPT_PROV_HANDLE, NCRYPT_RSA_ALGORITHM,
    NCRYPT_SILENT_FLAG, NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG, NCRYPT_UI_POLICY,
    NCRYPT_UI_POLICY_PROPERTY,
};

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
fn probe(passport: bool) -> Result<(), &'static str> {
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
        Ok(())
    })();
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
    let passport = match arguments.as_slice() {
        [attended, provider] if attended == "--attended" && provider == "passport" => true,
        [attended, provider] if attended == "--attended" && provider == "software" => false,
        _ => {
            eprintln!("Pass --attended passport or --attended software to run this disposable OS-prompt probe.");
            std::process::exit(2);
        }
    };
    match probe(passport) {
        Ok(()) => println!("probe-result: cryptographic-roundtrip-only"),
        Err(stage) => {
            eprintln!("probe-result: {stage}");
            std::process::exit(1);
        }
    }
}
