//! Key-release seam. A protector wraps the store's random data key at
//! initialization and unwraps it for each operation. The store never persists
//! the data key and never falls back to another protector.
//!
//! The selected protector for Windows 11 Home (Microsoft Software KSP with CNG
//! high-protection UI and a separate vault-key password) is [`crate::ksp`].
//! Neither DPAPI `CurrentUser` nor an application prompt is an acceptable
//! fallback, and a snapshot is never opened under a protector other than the
//! one its authenticated header names.
use crate::crypto::Secret;
use crate::outcome::{Failure, Outcome};

pub trait KeyProtector {
    /// Stable identifier recorded in the authenticated header.
    fn kind(&self) -> &'static str;
    fn wrap(&self, key: &Secret) -> Outcome<Vec<u8>>;
    fn unwrap(&self, wrapped: &[u8]) -> Outcome<Secret>;
}

/// Refuse a snapshot whose header names a different protector than the one
/// the caller supplied, before any unwrap attempt.
pub fn require_kind(header_kind: &str, protector: &dyn KeyProtector) -> Outcome<()> {
    if header_kind != protector.kind() {
        return Err(Failure::Invalid("protector-mismatch"));
    }
    Ok(())
}

#[cfg(feature = "developer-harness")]
pub use fixture::FixtureProtector;

#[cfg(feature = "developer-harness")]
mod fixture {
    use super::KeyProtector;
    use crate::crypto::{self, Secret, NONCE_LEN, TAG_LEN};
    use crate::outcome::{Failure, Outcome};

    const AAD: &[u8] = b"LunaOSHome.SnapshotStore.FixtureProtector.1";

    /// Developer-harness protector: the automated conformance and fault suites
    /// supply a 32-byte fixture key per invocation. It is never persisted and
    /// is not available in a default build. It is not a key-release method.
    pub struct FixtureProtector {
        key: Secret,
    }

    impl FixtureProtector {
        pub const KIND: &'static str = "fixture-aes256-gcm";

        pub fn new(key: [u8; 32]) -> Self {
            Self {
                key: Secret(key.to_vec()),
            }
        }
    }

    impl KeyProtector for FixtureProtector {
        fn kind(&self) -> &'static str {
            Self::KIND
        }

        fn wrap(&self, key: &Secret) -> Outcome<Vec<u8>> {
            let nonce = crypto::random::<NONCE_LEN>()?;
            let mut tag = [0u8; TAG_LEN];
            let cipher = crypto::gcm(&self.key, &nonce, AAD, &key.0, &mut tag, false)?;
            let mut wrapped = nonce.to_vec();
            wrapped.extend_from_slice(&tag);
            wrapped.extend_from_slice(&cipher.0);
            Ok(wrapped)
        }

        fn unwrap(&self, wrapped: &[u8]) -> Outcome<Secret> {
            if wrapped.len() != NONCE_LEN + TAG_LEN + 32 {
                return Err(Failure::Invalid("wrapped-key-length"));
            }
            let nonce: [u8; NONCE_LEN] = wrapped[..NONCE_LEN].try_into().expect("nonce length");
            let mut tag: [u8; TAG_LEN] = wrapped[NONCE_LEN..NONCE_LEN + TAG_LEN]
                .try_into()
                .expect("tag length");
            crypto::gcm(
                &self.key,
                &nonce,
                AAD,
                &wrapped[NONCE_LEN + TAG_LEN..],
                &mut tag,
                true,
            )
            .map_err(|_| Failure::StorageFailed("key-release-denied"))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn fixture_protector_round_trips_and_refuses_other_keys() {
            let protector = FixtureProtector::new([3; 32]);
            let data_key = crypto::data_key().unwrap();
            let wrapped = protector.wrap(&data_key).unwrap();
            assert_eq!(protector.unwrap(&wrapped).unwrap().0, data_key.0);
            assert!(FixtureProtector::new([4; 32]).unwrap(&wrapped).is_err());
            let mut altered = wrapped.clone();
            altered[NONCE_LEN + TAG_LEN] ^= 1;
            assert!(protector.unwrap(&altered).is_err());
            assert!(protector.unwrap(&wrapped[..wrapped.len() - 1]).is_err());
            assert!(super::super::require_kind("software-ksp", &protector).is_err());
            assert!(super::super::require_kind(FixtureProtector::KIND, &protector).is_ok());
        }
    }
}
