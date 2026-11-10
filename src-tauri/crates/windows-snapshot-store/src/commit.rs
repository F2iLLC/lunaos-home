//! Atomic snapshot replacement with uncertainty classification.
//!
//! Before the replacement boundary every failure is definite: the last
//! committed snapshot is intact and the pending file is removed. From the
//! first replacement attempt onward every failure, including a failed readback
//! or a failed pending-file cleanup, is `CommitUnknown`: the caller must read
//! the store before any retry and must never replay the mutation.
use crate::crypto;
use crate::fault::Fault;
use crate::format::MAX_FILE;
use crate::outcome::{Failure, Outcome};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

pub const PENDING_PREFIX: &str = "snapshot-";
pub const PENDING_SUFFIX: &str = ".pending";

#[derive(Default)]
struct CommitAttempt {
    replacement_attempted: bool,
}

impl CommitAttempt {
    fn replacing(&mut self) {
        // Set before calling the OS: even a failed replacement needs readback.
        self.replacement_attempted = true;
    }

    fn finish(self, operation: Outcome<()>, cleanup: Outcome<()>) -> Outcome<()> {
        let result = cleanup.and(operation);
        if self.replacement_attempted {
            unknown(result)
        } else {
            result
        }
    }
}

/// After replacement, any failure becomes an uncertain commit.
pub fn unknown<T>(result: Outcome<T>) -> Outcome<T> {
    result.map_err(|failure| match failure {
        Failure::CommitUnknown(reason) => Failure::CommitUnknown(reason),
        Failure::Invalid(reason) | Failure::StorageFailed(reason) => Failure::CommitUnknown(reason),
        Failure::Conflict | Failure::Unsupported | Failure::Busy => {
            Failure::CommitUnknown("post-commit-verification")
        }
    })
}

/// Read a regular, non-reparse file of bounded size.
pub fn read_bytes(path: &Path) -> Outcome<Vec<u8>> {
    use std::os::windows::fs::MetadataExt;
    let metadata =
        fs::symlink_metadata(path).map_err(|_| Failure::StorageFailed("file-unavailable"))?;
    if !metadata.is_file() || metadata.file_attributes() & 0x400 != 0 || metadata.len() > MAX_FILE {
        return Err(Failure::Invalid("file-size"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| Failure::StorageFailed("file-unavailable"))?
        .take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::StorageFailed("file-unavailable"))?;
    if bytes.len() as u64 > MAX_FILE {
        return Err(Failure::Invalid("file-size"));
    }
    Ok(bytes)
}

/// Write `bytes` to a fresh same-directory pending file, flush it, verify it
/// byte-for-byte and through `verify`, then replace `path` atomically and read
/// the result back. `replace` is false for the initial snapshot.
pub fn atomic_commit(
    path: &Path,
    bytes: &[u8],
    replace: bool,
    fault: Fault,
    verify: impl Fn(&[u8]) -> Outcome<()>,
) -> Outcome<()> {
    let pending = path.with_file_name(format!(
        "{PENDING_PREFIX}{}{PENDING_SUFFIX}",
        crypto::hex(&crypto::random::<16>()?)
    ));
    let mut owned = false;
    let mut attempt = CommitAttempt::default();
    let result = (|| {
        if fault == Fault::BeforeWrite {
            return Err(Failure::StorageFailed("injected-before-write"));
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending)
            .map_err(|_| Failure::StorageFailed("pending-create-failed"))?;
        owned = true;
        match fault {
            Fault::DuringWrite | Fault::DiskFull => {
                file.write_all(&bytes[..bytes.len() / 2])
                    .map_err(|_| Failure::StorageFailed("write-failed"))?;
                return Err(Failure::StorageFailed(if fault == Fault::DiskFull {
                    "injected-disk-full"
                } else {
                    "injected-during-write"
                }));
            }
            Fault::ProcessInterruption => {
                let _ = file.write_all(&bytes[..bytes.len() / 2]);
                // Abrupt termination: no cleanup, no response. The pending file
                // stays behind as ciphertext only; readers never promote it.
                std::process::exit(3);
            }
            _ => {}
        }
        file.write_all(bytes)
            .map_err(|_| Failure::StorageFailed("write-failed"))?;
        if fault == Fault::AfterWrite {
            return Err(Failure::StorageFailed("injected-after-write"));
        }
        file.sync_all()
            .map_err(|_| Failure::StorageFailed("flush-failed"))?;
        drop(file);
        if fault == Fault::TamperedTemporary {
            let mut tampered = read_bytes(&pending)?;
            let last = tampered.len() - 1;
            tampered[last] ^= 0x01;
            fs::write(&pending, &tampered)
                .map_err(|_| Failure::StorageFailed("injected-tamper-failed"))?;
        }
        // Verify the pending file before it can become the snapshot.
        let written = read_bytes(&pending)?;
        if written != bytes {
            return Err(Failure::StorageFailed("pending-verification-failed"));
        }
        verify(&written).map_err(|_| Failure::StorageFailed("pending-verification-failed"))?;
        if fault == Fault::BeforeReplacement {
            return Err(Failure::StorageFailed("injected-before-replacement"));
        }
        let source: Vec<u16> = pending.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let flags = if replace {
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH
        } else {
            MOVEFILE_WRITE_THROUGH
        };
        attempt.replacing();
        unsafe { MoveFileExW(PCWSTR(source.as_ptr()), PCWSTR(target.as_ptr()), flags) }
            .map_err(|_| Failure::CommitUnknown("replacement-failed"))?;
        if fault == Fault::AfterReplacement {
            return Err(Failure::CommitUnknown("injected-after-replacement"));
        }
        if read_bytes(path)? != bytes {
            return Err(Failure::CommitUnknown("readback-mismatch"));
        }
        verify(bytes)?;
        Ok(())
    })();
    let cleanup = if owned && pending.exists() {
        fs::remove_file(&pending).map_err(|_| Failure::StorageFailed("pending-cleanup-failed"))
    } else {
        Ok(())
    };
    attempt.finish(result, cleanup)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory(label: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "HomeSnapshotCommitTest-{label}-{}",
            crypto::hex(&crypto::random::<8>().unwrap())
        ));
        fs::create_dir(&directory).unwrap();
        directory
    }

    #[test]
    fn preparation_errors_remain_definite_and_replacement_errors_become_unknown() {
        assert_eq!(
            CommitAttempt::default().finish(Err(Failure::StorageFailed("write-failed")), Ok(())),
            Err(Failure::StorageFailed("write-failed"))
        );
        assert_eq!(
            CommitAttempt::default().finish(
                Err(Failure::StorageFailed("write-failed")),
                Err(Failure::StorageFailed("pending-cleanup-failed"))
            ),
            Err(Failure::StorageFailed("pending-cleanup-failed"))
        );
        for operation in [
            Ok(()),
            Err(Failure::CommitUnknown("replacement-failed")),
            Err(Failure::Invalid("file-size")),
        ] {
            for cleanup in [
                Ok(()),
                Err(Failure::StorageFailed("pending-cleanup-failed")),
            ] {
                let mut attempt = CommitAttempt::default();
                attempt.replacing();
                let result = attempt.finish(operation, cleanup);
                if operation.is_ok() && cleanup.is_ok() {
                    assert_eq!(result, Ok(()));
                } else {
                    assert!(
                        matches!(result, Err(Failure::CommitUnknown(_))),
                        "{result:?}"
                    );
                }
            }
        }
        assert_eq!(
            unknown::<()>(Err(Failure::Conflict)),
            Err(Failure::CommitUnknown("post-commit-verification"))
        );
    }

    #[test]
    fn injected_faults_preserve_the_old_snapshot_or_report_an_uncertain_commit() {
        let directory = directory("faults");
        let path = directory.join("snapshot.bin");
        let old = vec![1u8; 4096];
        let new = vec![2u8; 4096];
        let accept = |_: &[u8]| Ok(());
        atomic_commit(&path, &old, false, Fault::None, accept).unwrap();
        for fault in [
            Fault::BeforeWrite,
            Fault::DuringWrite,
            Fault::AfterWrite,
            Fault::BeforeReplacement,
            Fault::DiskFull,
            Fault::TamperedTemporary,
        ] {
            let result = atomic_commit(&path, &new, true, fault, accept);
            assert!(
                matches!(result, Err(Failure::StorageFailed(_))),
                "{fault:?}: {result:?}"
            );
            assert_eq!(
                read_bytes(&path).unwrap(),
                old,
                "{fault:?} must leave the old snapshot"
            );
            assert_eq!(
                fs::read_dir(&directory).unwrap().count(),
                1,
                "{fault:?} must remove its pending file"
            );
        }
        // A verifier refusal before replacement is definite and leaves no pending file.
        let refuse = |_: &[u8]| Err(Failure::Invalid("snapshot-format"));
        assert_eq!(
            atomic_commit(&path, &new, true, Fault::None, refuse),
            Err(Failure::StorageFailed("pending-verification-failed"))
        );
        assert_eq!(read_bytes(&path).unwrap(), old);
        // Create-new without replace refuses to overwrite an existing snapshot.
        assert!(matches!(
            atomic_commit(&path, &new, false, Fault::None, accept),
            Err(Failure::CommitUnknown(_))
        ));
        assert_eq!(read_bytes(&path).unwrap(), old);
        // After replacement, the new snapshot is committed even when the receipt is lost.
        assert_eq!(
            atomic_commit(&path, &new, true, Fault::AfterReplacement, accept),
            Err(Failure::CommitUnknown("injected-after-replacement"))
        );
        assert_eq!(read_bytes(&path).unwrap(), new);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        // A stale pending file is never promoted by a later successful commit.
        let stale = directory.join("snapshot-stale.pending");
        fs::write(&stale, &old[..100]).unwrap();
        atomic_commit(&path, &old, true, Fault::None, accept).unwrap();
        assert_eq!(read_bytes(&path).unwrap(), old);
        assert!(stale.exists());
        fs::remove_file(stale).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn bounded_reads_refuse_oversized_and_missing_files() {
        let directory = directory("reads");
        let path = directory.join("snapshot.bin");
        assert_eq!(
            read_bytes(&path),
            Err(Failure::StorageFailed("file-unavailable"))
        );
        fs::write(&path, vec![0u8; MAX_FILE as usize + 1]).unwrap();
        assert_eq!(read_bytes(&path), Err(Failure::Invalid("file-size")));
        assert_eq!(read_bytes(&directory), Err(Failure::Invalid("file-size")));
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
