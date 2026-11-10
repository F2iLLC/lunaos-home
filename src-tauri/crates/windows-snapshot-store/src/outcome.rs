//! Typed outcomes. Only `Conflict` and `Unsupported` carry contract meaning
//! across the adapter boundary; every other failure is either a definite
//! refusal before any persisted byte changed, or an uncertain commit.

/// Result alias used throughout the crate.
pub type Outcome<T> = Result<T, Failure>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// Definite comparison refusal before any persisted byte changed.
    Conflict,
    /// The target's record kind does not allow the requested operation.
    Unsupported,
    /// Malformed or out-of-bounds input, refused before any change.
    Invalid(&'static str),
    /// Another holder has the store lock; nothing changed.
    Busy,
    /// A failure before the replacement boundary; the last committed snapshot is intact.
    StorageFailed(&'static str),
    /// Replacement was attempted; the caller must read back before any retry.
    CommitUnknown(&'static str),
}

impl Failure {
    /// Stable wire code. Never carries record values, revisions or paths.
    pub fn code(&self) -> &'static str {
        match self {
            Failure::Conflict => "CONFLICT",
            Failure::Unsupported => "UNSUPPORTED",
            Failure::Invalid(_) => "INVALID",
            Failure::Busy => "BUSY",
            Failure::StorageFailed(_) => "STORAGE_FAILED",
            Failure::CommitUnknown(_) => "COMMIT_UNKNOWN",
        }
    }

    /// Static diagnostic identifier for tests and developer output. These are
    /// fixed identifiers, never OS messages, paths or data.
    pub fn reason(&self) -> Option<&'static str> {
        match self {
            Failure::Conflict | Failure::Unsupported | Failure::Busy => None,
            Failure::Invalid(reason)
            | Failure::StorageFailed(reason)
            | Failure::CommitUnknown(reason) => Some(reason),
        }
    }
}
