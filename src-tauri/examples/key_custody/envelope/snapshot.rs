//! Canonical snapshot format and fictional experiment-state validation.
pub(super) const FIXTURE_RECORD: &str = "Fictional Alex: blue paper kite";
pub(super) const UPDATED_FIXTURE_RECORD: &str = "Fictional Alex: green paper kite";
pub(super) const SNAPSHOT_MAGIC: &str = "LunaOSHome.FictionalSnapshot.1";
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Snapshot {
    pub(super) revision: u64,
    pub(super) record: String,
    pub(super) last_request: Option<String>,
    pub(super) receipt_revision: Option<u64>,
}
impl Snapshot {
    pub(super) fn initial() -> Self {
        Self {
            revision: 1,
            record: FIXTURE_RECORD.to_owned(),
            last_request: None,
            receipt_revision: None,
        }
    }
    pub(super) fn encode(&self) -> Vec<u8> {
        format!(
            "{SNAPSHOT_MAGIC}\n{}\n{}\n{}\n{}\n",
            self.revision,
            self.record,
            self.last_request.as_deref().unwrap_or("-"),
            self.receipt_revision
                .map(|value| value.to_string())
                .unwrap_or_else(|| "-".to_owned())
        )
        .into_bytes()
    }
    pub(super) fn decode(bytes: &[u8], envelope_revision: u64) -> Result<Self> {
        let snapshot = Self::parse(bytes)?;
        snapshot.validate_fixture_state(envelope_revision)?;
        Ok(snapshot)
    }

    // Parse the canonical wire format without applying the experiment's states.
    fn parse(bytes: &[u8]) -> Result<Self> {
        let text = std::str::from_utf8(bytes).map_err(|_| "snapshot-invalid")?;
        let parts: Vec<&str> = text.split('\n').collect();
        if parts.len() != 6 || parts[0] != SNAPSHOT_MAGIC || parts[5] != "" {
            return Err("snapshot-invalid");
        }
        let revision = parts[1].parse::<u64>().map_err(|_| "snapshot-invalid")?;
        let record = parts[2];
        let (last_request, receipt_revision) = if parts[3] == "-" && parts[4] == "-" {
            (None, None)
        } else {
            if parts[3].len() != 32 || !parts[3].bytes().all(|value| value.is_ascii_hexdigit()) {
                return Err("snapshot-invalid");
            }
            let receipt = parts[4].parse::<u64>().map_err(|_| "snapshot-invalid")?;
            (Some(parts[3].to_owned()), Some(receipt))
        };
        let snapshot = Self {
            revision,
            record: record.to_owned(),
            last_request,
            receipt_revision,
        };
        if snapshot.encode() != bytes {
            return Err("snapshot-invalid");
        }
        Ok(snapshot)
    }

    // Only these fictional states are permitted by the attended experiment.
    fn validate_fixture_state(&self, envelope_revision: u64) -> Result<()> {
        if self.revision != envelope_revision {
            return Err("snapshot-invalid");
        }
        match (
            self.record.as_str(),
            self.revision,
            self.last_request.is_some(),
            self.receipt_revision,
        ) {
            (FIXTURE_RECORD, 1, false, None) => Ok(()),
            (UPDATED_FIXTURE_RECORD, value, true, Some(receipt))
                if value >= 2 && receipt == value =>
            {
                Ok(())
            }
            _ => Err("snapshot-invalid"),
        }
    }
}

#[cfg(test)]
#[path = "snapshot_tests.rs"]
mod tests;
