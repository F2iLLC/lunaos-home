//! `WindowsSnapshotFileStore v1`.
//!
//! One encrypted file holds the complete versioned record snapshot. Every
//! mutation is a compare-and-swap on one record's revision, committed by
//! writing a flushed same-directory pending file, verifying it, replacing the
//! snapshot atomically, and reading the result back before acknowledging.
//!
//! This crate is deliberately standalone: it is not a dependency of the Home
//! application and exposes no Tauri command. The key-release seam is the
//! [`protector::KeyProtector`] trait. The only protector compiled here is the
//! developer-harness fixture protector (feature `developer-harness`); the
//! selected production protector (Microsoft Software KSP with high-protection
//! UI) and the Home enrollment/unlock/recovery lifecycle are separate work.
#![cfg(target_os = "windows")]

pub mod commit;
pub mod crypto;
pub mod fault;
pub mod format;
pub mod outcome;
pub mod protector;
pub mod store;
pub mod validate;

pub use outcome::{Failure, Outcome};
