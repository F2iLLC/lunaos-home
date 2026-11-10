//! Canonical on-disk format.
//!
//! ```text
//! LunaOSHome.SnapshotStore.1\n
//! <canonical header JSON>\n          <- authenticated as AES-GCM additional data
//! <12-byte nonce><16-byte tag><ciphertext>
//! ```
//!
//! The ciphertext is the canonical JSON snapshot `{ "records": { id: { revision, data } } }`.
//! Decoding re-encodes and compares bytes, so a noncanonical file is refused
//! before any cryptographic operation.
use crate::crypto::{self, Secret, NONCE_LEN, TAG_LEN};
use crate::outcome::{Failure, Outcome};
use crate::validate;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const MAGIC: &str = "LunaOSHome.SnapshotStore.1";
pub const FORMAT: u32 = 1;
/// Ceiling for one encoded `{ revision, data }` row; shared with the Windows
/// DPAPI probe and the in-memory reference adapter.
pub const RECORD_CEILING: usize = 262_144;
/// Ceiling for the complete plaintext snapshot.
pub const SNAPSHOT_CEILING: usize = 4 * 1024 * 1024;
/// Bound on records in one store.
pub const MAX_RECORDS: usize = 256;
/// Bound on bytes read from any snapshot or pending file.
pub const MAX_FILE: u64 = SNAPSHOT_CEILING as u64 + 65_536;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(deny_unknown_fields)]
pub struct Header {
    pub format: u32,
    #[serde(rename = "storeId")]
    pub store_id: String,
    pub protector: String,
    #[serde(rename = "wrappedKey")]
    pub wrapped_key: String,
    pub commit: String,
}

impl Header {
    fn validate(&self) -> Outcome<()> {
        if self.format != FORMAT {
            return Err(Failure::Invalid("format-version"));
        }
        if !validate::is_uuid(&self.store_id) || !validate::is_uuid(&self.commit) {
            return Err(Failure::Invalid("header-identifier"));
        }
        if self.protector.is_empty()
            || self.protector.len() > 64
            || !self
                .protector
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(Failure::Invalid("header-protector"));
        }
        let wrapped = crypto::unhex(&self.wrapped_key).ok_or(Failure::Invalid("header-key"))?;
        if wrapped.is_empty() || wrapped.len() > 4096 {
            return Err(Failure::Invalid("header-key"));
        }
        Ok(())
    }

    pub fn wrapped_key_bytes(&self) -> Outcome<Vec<u8>> {
        crypto::unhex(&self.wrapped_key).ok_or(Failure::Invalid("header-key"))
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SnapshotFile {
    pub header: Header,
    pub nonce: [u8; NONCE_LEN],
    pub tag: [u8; TAG_LEN],
    pub cipher: Vec<u8>,
}

impl SnapshotFile {
    fn header_bytes(header: &Header) -> Outcome<Vec<u8>> {
        header.validate()?;
        let mut aad = format!("{MAGIC}\n").into_bytes();
        aad.extend(serde_json::to_vec(header).map_err(|_| Failure::Invalid("header-encode"))?);
        aad.push(b'\n');
        Ok(aad)
    }

    /// The authenticated prefix: magic line plus canonical header line.
    pub fn aad(&self) -> Outcome<Vec<u8>> {
        Self::header_bytes(&self.header)
    }

    pub fn encode(&self) -> Outcome<Vec<u8>> {
        let mut bytes = self.aad()?;
        bytes.extend_from_slice(&self.nonce);
        bytes.extend_from_slice(&self.tag);
        bytes.extend_from_slice(&self.cipher);
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Outcome<Self> {
        if bytes.len() as u64 > MAX_FILE {
            return Err(Failure::Invalid("file-size"));
        }
        let magic_end = bytes
            .iter()
            .position(|b| *b == b'\n')
            .ok_or(Failure::Invalid("file-format"))?;
        if &bytes[..magic_end] != MAGIC.as_bytes() {
            return Err(Failure::Invalid("file-format"));
        }
        let rest = &bytes[magic_end + 1..];
        let header_end = rest
            .iter()
            .position(|b| *b == b'\n')
            .ok_or(Failure::Invalid("file-format"))?;
        let header: Header = serde_json::from_slice(&rest[..header_end])
            .map_err(|_| Failure::Invalid("file-header"))?;
        let body = &rest[header_end + 1..];
        if body.len() < NONCE_LEN + TAG_LEN + 1 {
            return Err(Failure::Invalid("file-format"));
        }
        let file = Self {
            header,
            nonce: body[..NONCE_LEN].try_into().expect("nonce length"),
            tag: body[NONCE_LEN..NONCE_LEN + TAG_LEN]
                .try_into()
                .expect("tag length"),
            cipher: body[NONCE_LEN + TAG_LEN..].to_vec(),
        };
        if file.encode()? != bytes {
            return Err(Failure::Invalid("file-noncanonical"));
        }
        Ok(file)
    }

    /// Encrypt a canonical snapshot under `key` with a fresh nonce.
    pub fn seal(header: Header, key: &Secret, plaintext: &[u8]) -> Outcome<Self> {
        if plaintext.len() > SNAPSHOT_CEILING {
            return Err(Failure::StorageFailed("snapshot-ceiling"));
        }
        let aad = Self::header_bytes(&header)?;
        let nonce = crypto::random::<NONCE_LEN>()?;
        let mut tag = [0u8; TAG_LEN];
        let cipher = crypto::gcm(key, &nonce, &aad, plaintext, &mut tag, false)?;
        Ok(Self {
            header,
            nonce,
            tag,
            cipher: cipher.0.clone(),
        })
    }

    pub fn open(&self, key: &Secret) -> Outcome<Secret> {
        if self.cipher.len() > SNAPSHOT_CEILING {
            return Err(Failure::Invalid("file-size"));
        }
        crypto::gcm(
            key,
            &self.nonce,
            &self.aad()?,
            &self.cipher,
            &mut self.tag.clone(),
            true,
        )
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub revision: String,
    pub data: Value,
}

impl Row {
    /// Encoded size of this row, refused above [`RECORD_CEILING`].
    pub fn check_size(&self) -> Outcome<usize> {
        let encoded = serde_json::to_vec(self).map_err(|_| Failure::Invalid("row-encode"))?;
        if encoded.len() > RECORD_CEILING {
            return Err(Failure::Invalid("record-ceiling"));
        }
        Ok(encoded.len())
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub records: BTreeMap<String, Row>,
}

impl Snapshot {
    pub fn encode(&self) -> Outcome<Vec<u8>> {
        if self.records.len() > MAX_RECORDS {
            return Err(Failure::StorageFailed("record-count"));
        }
        for (id, row) in &self.records {
            validate::record_id(id)?;
            validate::revision(&row.revision)?;
            validate::record_data(&row.data)?;
            row.check_size()?;
        }
        let bytes = serde_json::to_vec(self).map_err(|_| Failure::Invalid("snapshot-encode"))?;
        if bytes.len() > SNAPSHOT_CEILING {
            return Err(Failure::StorageFailed("snapshot-ceiling"));
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Outcome<Self> {
        if bytes.len() > SNAPSHOT_CEILING {
            return Err(Failure::Invalid("snapshot-size"));
        }
        let snapshot: Self =
            serde_json::from_slice(bytes).map_err(|_| Failure::Invalid("snapshot-format"))?;
        if snapshot.encode()? != bytes {
            return Err(Failure::Invalid("snapshot-noncanonical"));
        }
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn header(protector: &str) -> Header {
        Header {
            format: FORMAT,
            store_id: "0f3d5c2a-1b4e-4c6d-8e9f-0a1b2c3d4e5f".into(),
            protector: protector.into(),
            wrapped_key: crypto::hex(&[9; 60]),
            commit: crypto::uuid_v4().unwrap(),
        }
    }

    fn sample_snapshot() -> Snapshot {
        let mut snapshot = Snapshot::default();
        snapshot.records.insert(
            "alex-work".into(),
            Row {
                revision: crypto::uuid_v4().unwrap(),
                data: json!({ "memberId": "alex-example", "label": "Workplace", "value": "Willow Studio" }),
            },
        );
        snapshot
    }

    #[test]
    fn file_round_trips_and_is_canonical() {
        let key = crypto::data_key().unwrap();
        let plaintext = sample_snapshot().encode().unwrap();
        let file = SnapshotFile::seal(header("fixture-aes256-gcm"), &key, &plaintext).unwrap();
        let bytes = file.encode().unwrap();
        let decoded = SnapshotFile::decode(&bytes).unwrap();
        assert_eq!(decoded, file);
        assert_eq!(decoded.open(&key).unwrap().0, plaintext);
        assert!(decoded.open(&crypto::data_key().unwrap()).is_err());
        // Every single-byte corruption is refused: header bytes break canonical
        // decoding or authentication; body bytes break authentication.
        for index in (0..bytes.len()).step_by(7) {
            let mut broken = bytes.clone();
            broken[index] ^= 0x01;
            let refused = match SnapshotFile::decode(&broken) {
                Err(_) => true,
                Ok(decoded) => decoded.open(&key).is_err(),
            };
            assert!(refused, "byte {index} must not decode and decrypt");
        }
        assert!(
            SnapshotFile::decode(&bytes[..bytes.len() - 1])
                .map(|f| f.open(&key))
                .is_err()
                || SnapshotFile::decode(&bytes[..bytes.len() - 1])
                    .unwrap()
                    .open(&key)
                    .is_err()
        );
        assert!(SnapshotFile::decode(
            b"LunaOSHome.SnapshotStore.2\n{}\n0123456789012345678901234567890"
        )
        .is_err());
    }

    #[test]
    fn header_refuses_unknown_fields_and_bad_identifiers() {
        let mut bad = header("fixture-aes256-gcm");
        bad.store_id = "not-a-uuid".into();
        assert!(SnapshotFile::header_bytes(&bad).is_err());
        let mut bad = header("Fixture");
        bad.protector = "Fixture".into();
        assert!(SnapshotFile::header_bytes(&bad).is_err());
        let mut bad = header("fixture-aes256-gcm");
        bad.wrapped_key = "ABCD".into();
        assert!(SnapshotFile::header_bytes(&bad).is_err());
        let text = r#"{"format":1,"storeId":"0f3d5c2a-1b4e-4c6d-8e9f-0a1b2c3d4e5f","protector":"fixture-aes256-gcm","wrappedKey":"00","commit":"0f3d5c2a-1b4e-4c6d-8e9f-0a1b2c3d4e5f","extra":1}"#;
        assert!(serde_json::from_str::<Header>(text).is_err());
    }

    #[test]
    fn snapshot_is_canonical_bounded_and_validated() {
        let snapshot = sample_snapshot();
        let bytes = snapshot.encode().unwrap();
        assert_eq!(Snapshot::decode(&bytes).unwrap(), snapshot);
        // Key order is normalized, so a reordered encoding is noncanonical.
        let reordered = br#"{"records":{"alex-work":{"data":{"value":"Willow Studio","label":"Workplace","memberId":"alex-example"},"revision":"0f3d5c2a-1b4e-4c6d-8e9f-0a1b2c3d4e5f"}}}"#;
        assert!(Snapshot::decode(reordered).is_err());
        assert!(Snapshot::decode(br#"{"records":{},"extra":1}"#).is_err());
        let mut bad_id = snapshot.clone();
        let row = bad_id.records.remove("alex-work").unwrap();
        bad_id.records.insert("Alex Work".into(), row);
        assert_eq!(bad_id.encode(), Err(Failure::Invalid("record-id")));
        let mut oversized = snapshot.clone();
        oversized.records.get_mut("alex-work").unwrap().data = json!({
            "kind": "grocery-list",
            "list": { "id": "weekly", "householdId": "home", "label": "Weekly", "items": [], "revision": "0f3d5c2a-1b4e-4c6d-8e9f-0a1b2c3d4e5f", "updatedBy": { "kind": "human", "id": "p" } },
            "outcomes": (0..64).map(|i| json!({ "requestId": format!("0f3d5c2a-1b4e-4c6d-8e9f-0a1b2c3d{:04x}", i), "fingerprint": "n".repeat(8000), "receipt": { "status": "applied" } })).collect::<Vec<_>>()
        });
        assert_eq!(oversized.encode(), Err(Failure::Invalid("record-ceiling")));
    }
}
