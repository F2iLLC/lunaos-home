//! Error classification across the irreversible replacement boundary.
const UNKNOWN: &str = "commit-unknown-readback-required";

#[derive(Default)]
pub(super) struct CommitAttempt {
    replacement_attempted: bool,
}

impl CommitAttempt {
    pub(super) fn replacing(&mut self) {
        // Set before calling the OS: even a failed replacement needs readback.
        self.replacement_attempted = true;
    }

    pub(super) fn finish(
        self,
        operation: Result<(), &'static str>,
        cleanup: Result<(), &'static str>,
    ) -> Result<(), &'static str> {
        let result = cleanup.and(operation);
        if self.replacement_attempted {
            verify(result)
        } else {
            result
        }
    }
}

// Once replacement succeeded, every failed verification is an uncertain write,
// including read, decode, authentication and snapshot validation failures.
pub(super) fn verify<T>(result: Result<T, &'static str>) -> Result<T, &'static str> {
    result.map_err(|_| UNKNOWN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preparation_errors_remain_definite() {
        assert_eq!(
            CommitAttempt::default().finish(Err("write-failed"), Ok(())),
            Err("write-failed")
        );
        assert_eq!(
            CommitAttempt::default().finish(Err("write-failed"), Err("pending-cleanup-failed")),
            Err("pending-cleanup-failed")
        );
    }

    #[test]
    fn replacement_errors_and_cleanup_failures_require_reconciliation() {
        for operation in [Ok(()), Err("move-failed"), Err("envelope-unavailable")] {
            for cleanup in [Ok(()), Err("pending-cleanup-failed")] {
                let mut attempt = CommitAttempt::default();
                attempt.replacing();
                let expected = if operation.is_ok() && cleanup.is_ok() {
                    Ok(())
                } else {
                    Err(UNKNOWN)
                };
                assert_eq!(attempt.finish(operation, cleanup), expected);
            }
        }
    }

    #[test]
    fn post_commit_verification_never_reports_a_definite_write_failure() {
        for error in [
            "envelope-unavailable",
            "envelope-invalid",
            "authentication-failed",
            "snapshot-invalid",
        ] {
            assert_eq!(verify::<()>(Err(error)), Err(UNKNOWN));
        }
        assert_eq!(verify(Ok(7)), Ok(7));
    }
}
