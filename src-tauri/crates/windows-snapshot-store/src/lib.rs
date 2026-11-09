//! `WindowsSnapshotFileStore v1`.
//!
//! One encrypted file holds the complete versioned record snapshot. Every
//! mutation is a compare-and-swap on one record's revision, committed by
//! writing a flushed same-directory pending file, verifying it, replacing the
//! snapshot atomically, and reading the result back before acknowledging.
//!
//! This crate is deliberately standalone: it is not a dependency of the Home
//! application and exposes no Tauri command. The key-release seam is the
//! [`protector::KeyProtector`] trait. Two protectors exist: the developer-harness
//! fixture protector (feature `developer-harness`) and the selected Microsoft
//! Software KSP protector ([`ksp`]), which is used through one process-bounded
//! unlock session ([`owner`]). Home's enrollment/unlock/recovery product
//! lifecycle is separate work.
#![cfg(target_os = "windows")]

pub mod commit;
pub mod crypto;
pub mod fault;
pub mod format;
pub mod ksp;
pub mod outcome;
pub mod owner;
pub mod protector;
pub mod store;
pub mod validate;

pub use outcome::{Failure, Outcome};
