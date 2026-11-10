//! Microsoft Software KSP key protector: the selected Windows 11 Home method.
//!
//! One persisted, non-exportable RSA-2048 key per store lives in the Microsoft
//! Software Key Storage Provider under CNG's high-protection UI policy. Windows
//! owns the dialog in which the owner creates and later enters a separate
//! vault password; this crate never sees, collects or stores that password.
//! The store's random data key is wrapped with RSA-OAEP-SHA256.
//!
//! This is a separate vault-password method. It is not Windows sign-in, not
//! Windows Hello and not TPM-backed, and Windows account recovery does not
//! recover the key. Losing the key or its password locks the snapshot until a
//! separately qualified recovery route succeeds. There is no DPAPI, fixture or
//! application-prompt fallback.
//!
//! Release model: the first unwrap on a protector asks Windows for the
//! password. Later unwraps on the same open handle are silent, so one unlocked
//! session can serve several operations with a single gesture. Dropping the
//! protector (in practice: ending the session process) is the lock. Before the
//! first release an opened protector proves, on a separate handle, that a
//! silent unwrap is refused; a key that releases without the dialog is rejected.
use crate::crypto::Secret;
use crate::outcome::{Failure, Outcome};
use crate::protector::KeyProtector;
use crate::validate;
use std::cell::Cell;
use std::mem::size_of;
use windows::core::{w, PCWSTR};
use windows::Win32::Security::Cryptography::{
    NCryptCreatePersistedKey, NCryptDecrypt, NCryptDeleteKey, NCryptEncrypt, NCryptFinalizeKey,
    NCryptFreeObject, NCryptOpenKey, NCryptOpenStorageProvider, NCryptSetProperty,
    BCRYPT_OAEP_PADDING_INFO, BCRYPT_SHA256_ALGORITHM, CERT_KEY_SPEC, MS_KEY_STORAGE_PROVIDER,
    NCRYPT_ALLOW_DECRYPT_FLAG, NCRYPT_EXPORT_POLICY_PROPERTY, NCRYPT_FLAGS, NCRYPT_KEY_HANDLE,
    NCRYPT_KEY_USAGE_PROPERTY, NCRYPT_LENGTH_PROPERTY, NCRYPT_PAD_OAEP_FLAG, NCRYPT_PROV_HANDLE,
    NCRYPT_RSA_ALGORITHM, NCRYPT_SILENT_FLAG, NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG,
    NCRYPT_UI_POLICY, NCRYPT_UI_POLICY_PROPERTY, NCRYPT_WINDOW_HANDLE_PROPERTY,
};

/// Recorded in the authenticated snapshot header.
pub const KIND: &str = "software-ksp-rsa2048-oaep-sha256";
const KEY_PREFIX: &str = "LunaOSHome.VaultKey.";
const WRAPPED_LEN: usize = 256;
const DATA_KEY_LEN: usize = 32;
const NTE_BAD_KEYSET: u32 = 0x8009_0016;
const NTE_EXISTS: u32 = 0x8009_000F;

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
        // A successful delete also frees the handle.
        let deleted = unsafe { NCryptDeleteKey(self.0, 0) }.is_ok();
        if deleted {
            self.0 = NCRYPT_KEY_HANDLE(0);
        }
        deleted
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

/// The persisted key name is derived from the store identifier only.
pub fn key_name(store_id: &str) -> Outcome<String> {
    if !validate::is_uuid(store_id) {
        return Err(Failure::Invalid("store-id"));
    }
    Ok(format!("{KEY_PREFIX}{}", store_id.replace('-', "")))
}

fn provider() -> Outcome<Provider> {
    let mut handle = NCRYPT_PROV_HANDLE(0);
    unsafe { NCryptOpenStorageProvider(&mut handle, MS_KEY_STORAGE_PROVIDER, 0) }
        .map_err(|_| Failure::StorageFailed("key-provider-unavailable"))?;
    Ok(Provider(handle))
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

fn open_key(provider: &Provider, name: &str) -> Outcome<Key> {
    let name = wide(name);
    let mut handle = NCRYPT_KEY_HANDLE(0);
    match unsafe {
        NCryptOpenKey(
            provider.0,
            &mut handle,
            PCWSTR(name.as_ptr()),
            CERT_KEY_SPEC(1),
            NCRYPT_FLAGS(0),
        )
    } {
        Ok(()) => Ok(Key(handle)),
        Err(error) if error.code().0 as u32 == NTE_BAD_KEYSET => {
            Err(Failure::StorageFailed("protector-missing"))
        }
        Err(_) => Err(Failure::StorageFailed("protector-unavailable")),
    }
}

fn property<T>(key: &Key, name: PCWSTR, value: &T) -> Outcome<()> {
    let bytes =
        unsafe { std::slice::from_raw_parts(value as *const T as *const u8, size_of::<T>()) };
    unsafe { NCryptSetProperty(key.0.into(), name, bytes, NCRYPT_FLAGS(0)) }
        .map_err(|_| Failure::StorageFailed("key-policy-unavailable"))
}

// RSA-OAEP-SHA256 through the provider. Output is held in a wiping buffer.
fn crypt(key: &Key, input: &[u8], decrypt: bool, silent: bool) -> Result<Secret, ()> {
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
    // RSA-2048 output never exceeds the modulus size; a fixed buffer avoids a
    // sizing call that would otherwise repeat the private-key operation.
    let mut output = Secret(vec![0u8; WRAPPED_LEN]);
    let mut size = 0u32;
    call(Some(&mut output.0), &mut size).map_err(|_| ())?;
    if size == 0 || size as usize > output.0.len() {
        return Err(());
    }
    output.0.truncate(size as usize);
    Ok(output)
}

pub struct SoftwareKspProtector {
    key: Key,
    // A second handle to the same persisted key, used only to prove that a
    // silent release is refused before the attended release happens.
    probe: Option<Key>,
    released: Cell<bool>,
    require_password_protection: bool,
    _provider: Provider,
}

impl SoftwareKspProtector {
    /// Create this store's persisted key. Windows shows its own dialog, owned
    /// by `owner_window`, in which the owner creates the vault password.
    /// Refuses an existing key; a cancelled dialog leaves no key behind.
    pub fn enroll(store_id: &str, owner_window: isize) -> Outcome<Self> {
        let name = key_name(store_id)?;
        let provider = provider()?;
        let wide_name = wide(&name);
        let mut handle = NCRYPT_KEY_HANDLE(0);
        match unsafe {
            NCryptCreatePersistedKey(
                provider.0,
                &mut handle,
                NCRYPT_RSA_ALGORITHM,
                PCWSTR(wide_name.as_ptr()),
                CERT_KEY_SPEC(1),
                NCRYPT_FLAGS(0),
            )
        } {
            Ok(()) => {}
            Err(error) if error.code().0 as u32 == NTE_EXISTS => {
                return Err(Failure::StorageFailed("protector-exists"))
            }
            Err(_) => return Err(Failure::StorageFailed("protector-create-failed")),
        }
        let mut key = Key(handle);
        let configured = (|| {
            property(&key, NCRYPT_LENGTH_PROPERTY, &2048u32)?;
            property(&key, NCRYPT_EXPORT_POLICY_PROPERTY, &0u32)?;
            property(&key, NCRYPT_KEY_USAGE_PROPERTY, &NCRYPT_ALLOW_DECRYPT_FLAG)?;
            property(
                &key,
                NCRYPT_WINDOW_HANDLE_PROPERTY,
                &(owner_window as usize),
            )?;
            property(
                &key,
                NCRYPT_UI_POLICY_PROPERTY,
                &NCRYPT_UI_POLICY {
                    dwVersion: 1,
                    dwFlags: NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG,
                    pszCreationTitle: w!("Luna OS Home vault"),
                    pszFriendlyName: w!("Luna OS Home vault password"),
                    pszDescription: w!(
                        "Create a separate vault password. Do not use your Windows password. Home cannot see or recover it."
                    ),
                },
            )?;
            unsafe { NCryptFinalizeKey(key.0, NCRYPT_FLAGS(0)) }
                .map_err(|_| Failure::StorageFailed("protector-creation-denied"))
        })();
        if let Err(failure) = configured {
            // A cancelled or failed setup must leave no key behind.
            if !key.delete() {
                return Err(Failure::StorageFailed("protector-cleanup-required"));
            }
            return Err(failure);
        }
        // This handle just created the key under the high-protection policy,
        // and Windows may already hold its password for this process, so the
        // silent-refusal proof belongs to open in a later, fresh process.
        Ok(Self {
            key,
            probe: None,
            released: Cell::new(false),
            require_password_protection: false,
            _provider: provider,
        })
    }

    /// Open this store's existing key without releasing anything. No dialog
    /// appears until the first unwrap.
    pub fn open(store_id: &str, owner_window: isize) -> Outcome<Self> {
        let name = key_name(store_id)?;
        let provider = provider()?;
        let key = open_key(&provider, &name)?;
        property(
            &key,
            NCRYPT_WINDOW_HANDLE_PROPERTY,
            &(owner_window as usize),
        )?;
        let probe = open_key(&provider, &name)?;
        Ok(Self {
            key,
            probe: Some(probe),
            released: Cell::new(false),
            require_password_protection: true,
            _provider: provider,
        })
    }

    /// Delete this store's persisted key. A missing key is not an error:
    /// returns whether a key existed. Deletion makes every snapshot wrapped
    /// under the key permanently unreadable.
    pub fn delete(store_id: &str) -> Outcome<bool> {
        let name = key_name(store_id)?;
        let provider = provider()?;
        match open_key(&provider, &name) {
            Ok(mut key) => {
                if key.delete() {
                    Ok(true)
                } else {
                    Err(Failure::StorageFailed("protector-cleanup-required"))
                }
            }
            Err(Failure::StorageFailed("protector-missing")) => Ok(false),
            Err(failure) => Err(failure),
        }
    }

    /// Whether a key exists for this store, without opening a release path.
    pub fn exists(store_id: &str) -> Outcome<bool> {
        let name = key_name(store_id)?;
        let provider = provider()?;
        match open_key(&provider, &name) {
            Ok(_) => Ok(true),
            Err(Failure::StorageFailed("protector-missing")) => Ok(false),
            Err(failure) => Err(failure),
        }
    }

    /// Whether the attended release has already happened on this protector.
    pub fn released(&self) -> bool {
        self.released.get()
    }
}

impl KeyProtector for SoftwareKspProtector {
    fn kind(&self) -> &'static str {
        KIND
    }

    // Public-key operation: never prompts.
    fn wrap(&self, key: &Secret) -> Outcome<Vec<u8>> {
        if key.0.len() != DATA_KEY_LEN {
            return Err(Failure::Invalid("data-key-length"));
        }
        let wrapped = crypt(&self.key, &key.0, false, true)
            .map_err(|_| Failure::StorageFailed("key-wrap-failed"))?;
        if wrapped.0.len() != WRAPPED_LEN {
            return Err(Failure::StorageFailed("key-wrap-failed"));
        }
        Ok(wrapped.0.clone())
    }

    fn unwrap(&self, wrapped: &[u8]) -> Outcome<Secret> {
        if wrapped.len() != WRAPPED_LEN {
            return Err(Failure::Invalid("wrapped-key-length"));
        }
        let released = if self.released.get() {
            crypt(&self.key, wrapped, true, true)
        } else {
            if self.require_password_protection {
                let probe = self.probe.as_ref().unwrap_or(&self.key);
                if crypt(probe, wrapped, true, true).is_ok() {
                    // The key answers without the Windows dialog: it is not
                    // the password-protected key this method requires.
                    return Err(Failure::StorageFailed("protector-not-password-protected"));
                }
            }
            crypt(&self.key, wrapped, true, false)
        };
        let secret = released.map_err(|_| Failure::StorageFailed("key-release-denied"))?;
        if secret.0.len() != DATA_KEY_LEN {
            return Err(Failure::StorageFailed("key-release-denied"));
        }
        self.released.set(true);
        Ok(secret)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto;

    // Unnamed, nonpersistent, unprotected key: exercises the provider calls
    // without any dialog. It is never evidence of password protection.
    fn ephemeral(require_password_protection: bool) -> SoftwareKspProtector {
        let provider = provider().unwrap();
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
        SoftwareKspProtector {
            key,
            probe: None,
            released: Cell::new(false),
            require_password_protection,
            _provider: provider,
        }
    }

    #[test]
    fn key_names_derive_only_from_canonical_store_identifiers() {
        assert_eq!(
            key_name("6f1c2a0e-3b4d-4c5e-8f60-718293a4b5c6").unwrap(),
            "LunaOSHome.VaultKey.6f1c2a0e3b4d4c5e8f60718293a4b5c6"
        );
        for invalid in [
            "",
            "weekly",
            "6F1C2A0E-3B4D-4C5E-8F60-718293A4B5C6",
            "..\\x",
        ] {
            assert_eq!(key_name(invalid), Err(Failure::Invalid("store-id")));
        }
    }

    #[test]
    fn wraps_and_unwraps_a_data_key_and_refuses_tampering() {
        let protector = ephemeral(false);
        assert_eq!(protector.kind(), KIND);
        assert!(!protector.released());
        let data_key = crypto::data_key().unwrap();
        let wrapped = protector.wrap(&data_key).unwrap();
        assert_eq!(wrapped.len(), WRAPPED_LEN);
        assert_ne!(
            protector.wrap(&data_key).unwrap(),
            wrapped,
            "OAEP is randomized"
        );
        assert_eq!(protector.unwrap(&wrapped).unwrap().0, data_key.0);
        assert!(protector.released());
        assert_eq!(protector.unwrap(&wrapped).unwrap().0, data_key.0);
        let mut altered = wrapped.clone();
        altered[0] ^= 1;
        assert_eq!(
            protector.unwrap(&altered).err(),
            Some(Failure::StorageFailed("key-release-denied"))
        );
        assert_eq!(
            protector.unwrap(&wrapped[..255]).err(),
            Some(Failure::Invalid("wrapped-key-length"))
        );
        assert_eq!(
            protector.wrap(&Secret(vec![1; 31])).err(),
            Some(Failure::Invalid("data-key-length"))
        );
        assert!(ephemeral(false).unwrap(&wrapped).is_err(), "another key");
    }

    #[test]
    fn a_key_that_releases_without_the_windows_dialog_is_rejected() {
        let protector = ephemeral(true);
        let wrapped = protector.wrap(&crypto::data_key().unwrap()).unwrap();
        assert_eq!(
            protector.unwrap(&wrapped).err(),
            Some(Failure::StorageFailed("protector-not-password-protected"))
        );
        assert!(!protector.released());
    }

    #[test]
    fn a_missing_key_is_reported_without_any_dialog() {
        let store_id = crypto::uuid_v4().unwrap();
        assert_eq!(SoftwareKspProtector::exists(&store_id), Ok(false));
        assert_eq!(
            SoftwareKspProtector::open(&store_id, 0).err(),
            Some(Failure::StorageFailed("protector-missing"))
        );
        assert_eq!(SoftwareKspProtector::delete(&store_id), Ok(false));
    }

    #[test]
    fn a_store_runs_its_whole_lifecycle_on_a_provider_key() {
        use crate::store::Store;
        use serde_json::json;
        let store_id = crypto::uuid_v4().unwrap();
        let store = Store::init(&store_id, Box::new(ephemeral(false))).unwrap();
        let profile = |value: &str| json!({ "memberId": "alex-example", "label": "Workplace", "value": value });
        let created = store.create("alex-work", profile("Willow Studio")).unwrap();
        let edited = store
            .edit("alex-work", profile("Cedar Workshop"), &created)
            .unwrap();
        assert_ne!(created, edited);
        assert_eq!(
            store.edit("alex-work", profile("Stale"), &created),
            Err(Failure::Conflict)
        );
        let row = store.read("alex-work").unwrap().unwrap();
        assert_eq!(row.revision, edited);
        assert_eq!(row.data, profile("Cedar Workshop"));
        let bytes = crate::commit::read_bytes(&store.directory().join("snapshot.bin")).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains(KIND));
        assert!(!text.contains("Cedar Workshop") && !text.contains(&edited));
        // A different provider key cannot open the same snapshot.
        assert!(Store::open(&store_id, Box::new(ephemeral(false))).is_err());
        store.cleanup().unwrap();
    }
}
