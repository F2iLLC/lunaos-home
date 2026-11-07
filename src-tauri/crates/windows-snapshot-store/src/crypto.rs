//! Windows CNG primitives: system RNG and AES-256-GCM. No custom cryptography.
use crate::outcome::{Failure, Outcome};
use std::mem::size_of;
use windows::core::PCWSTR;
use windows::Win32::Security::Cryptography::*;

/// Owned secret bytes, zeroed on drop. Volatile stores cover this buffer only,
/// not OS paging, crash dumps, compiler copies or a compromised same-user process.
pub struct Secret(pub Vec<u8>);

impl Drop for Secret {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

pub fn wipe(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

pub fn random<const N: usize>() -> Outcome<[u8; N]> {
    let mut value = [0u8; N];
    if unsafe { BCryptGenRandom(None, &mut value, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.0 < 0 {
        return Err(Failure::StorageFailed("random-unavailable"));
    }
    Ok(value)
}

/// A fresh 256-bit data key from the system RNG.
pub fn data_key() -> Outcome<Secret> {
    Ok(Secret(random::<32>()?.to_vec()))
}

/// Canonical lowercase UUID v4 built from the system RNG.
pub fn uuid_v4() -> Outcome<String> {
    let mut bytes = random::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = hex(&bytes);
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn unhex(value: &str) -> Option<Vec<u8>> {
    if value.len() > 65536 || !value.len().is_multiple_of(2) || !value.is_ascii() {
        return None;
    }
    if value.bytes().any(|byte| byte.is_ascii_uppercase()) {
        return None; // Canonical lowercase only.
    }
    (0..value.len())
        .step_by(2)
        .map(|offset| u8::from_str_radix(&value[offset..offset + 2], 16).ok())
        .collect()
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

pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
/// Upper bound on one AES-GCM input; the snapshot ceiling is lower.
pub const MAX_GCM_INPUT: usize = 8 * 1024 * 1024;

/// AES-256-GCM through Windows CNG. The caller supplies the complete canonical
/// header as additional authenticated data. Decryption failure never returns
/// partial plaintext.
pub fn gcm(
    key: &Secret,
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    input: &[u8],
    tag: &mut [u8; TAG_LEN],
    decrypt: bool,
) -> Outcome<Secret> {
    if key.0.len() != 32 || input.len() > MAX_GCM_INPUT || aad.len() > MAX_GCM_INPUT {
        return Err(Failure::Invalid("cipher-input"));
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
        return Err(Failure::StorageFailed("cipher-unavailable"));
    }
    let algorithm = Algorithm(algorithm);
    let mode: Vec<u8> = "ChainingModeGCM\0"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    if unsafe { BCryptSetProperty(algorithm.0.into(), BCRYPT_CHAINING_MODE, &mode, 0) }.0 < 0 {
        return Err(Failure::StorageFailed("cipher-unavailable"));
    }
    let mut handle = BCRYPT_KEY_HANDLE::default();
    if unsafe { BCryptGenerateSymmetricKey(algorithm.0, &mut handle, None, &key.0, 0) }.0 < 0 {
        return Err(Failure::StorageFailed("cipher-unavailable"));
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
        return Err(Failure::StorageFailed("authentication-failed"));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        tag[0] ^= 1;
        assert!(gcm(&key, &[0; 12], b"", &cipher.0, &mut tag, true).is_err());
    }

    #[test]
    fn uuid_v4_is_canonical_lowercase_and_random() {
        let first = uuid_v4().unwrap();
        let second = uuid_v4().unwrap();
        assert_ne!(first, second);
        for value in [&first, &second] {
            assert_eq!(value.len(), 36);
            assert_eq!(&value[14..15], "4");
            assert!(matches!(&value[19..20], "8" | "9" | "a" | "b"));
            assert!(value
                .bytes()
                .all(|b| b == b'-' || (b.is_ascii_hexdigit() && !b.is_ascii_uppercase())));
        }
    }

    #[test]
    fn hex_round_trip_refuses_noncanonical_input() {
        assert_eq!(unhex(&hex(&[0, 255, 16])).unwrap(), vec![0, 255, 16]);
        assert!(unhex("AB").is_none());
        assert!(unhex("abc").is_none());
        assert!(unhex("zz").is_none());
    }

    #[test]
    fn owned_secret_wipe_clears_bytes() {
        let mut bytes = vec![17; 32];
        wipe(&mut bytes);
        assert_eq!(bytes, vec![0; 32]);
    }
}
