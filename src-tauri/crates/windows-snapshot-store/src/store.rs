//! `WindowsSnapshotFileStore v1`: one encrypted snapshot per store directory,
//! compare-and-swap on record revisions, exclusive lock per operation.
use crate::commit::{atomic_commit, read_bytes, PENDING_PREFIX, PENDING_SUFFIX};
use crate::crypto::{self, Secret};
use crate::fault::Fault;
use crate::format::{Header, Row, Snapshot, SnapshotFile, FORMAT};
use crate::outcome::{Failure, Outcome};
use crate::protector::{self, KeyProtector};
use crate::validate::{self, Kind};
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const SNAPSHOT_FILE: &str = "snapshot.bin";
pub const LOCK_FILE: &str = ".lock";
const LOCK_WAIT: Duration = Duration::from_secs(5);
const LOCK_POLL_MIN: Duration = Duration::from_millis(10);
const LOCK_POLL_MAX: Duration = Duration::from_millis(200);
// Windows sharing/lock violations mean another holder has the lease; every
// other open error (access denied, a directory in the way) is permanent.
const ERROR_SHARING_VIOLATION: i32 = 32;
const ERROR_LOCK_VIOLATION: i32 = 33;
const REPARSE_POINT: u32 = 0x400;

/// Store directories live under the current user's local application data,
/// never under the checkout or a cloud-synchronized folder. The user-selected
/// production location and its backup exclusions are later Home setup work.
pub fn directory_for(store_id: &str) -> Outcome<PathBuf> {
    if !validate::is_uuid(store_id) {
        return Err(Failure::Invalid("store-id"));
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .ok_or(Failure::StorageFailed("local-app-data-unavailable"))?;
    let directory = PathBuf::from(base)
        .join("LunaOSHome")
        .join("SnapshotStores")
        .join(store_id);
    ordinary_path(&directory)?;
    Ok(directory)
}

fn ordinary_path(path: &Path) -> Outcome<()> {
    for ancestor in path.ancestors() {
        if let Ok(metadata) = fs::symlink_metadata(ancestor) {
            if metadata.file_attributes() & REPARSE_POINT != 0 {
                return Err(Failure::Invalid("reparse-point"));
            }
        }
    }
    Ok(())
}

struct Loaded {
    header: Header,
    key: Secret,
    snapshot: Snapshot,
}

const SETUP_SUFFIX: &str = ".setup";
const FILE_SHARE_DELETE: u32 = 0x4;

/// Exclusive claim on one store identifier's first-time setup.
///
/// A marker file beside the store directory exists from before the protector
/// is created until the store's first successful unlock. While a `Setup` is
/// alive no other process can claim the same identifier. If the process dies
/// in between, the marker stays: it is the durable record that whatever key or
/// store exists for this identifier has never been unlocked and holds nothing,
/// so the next setup may clear it and start again. A store that has been
/// unlocked once has no marker and is never cleared this way.
pub struct Setup {
    path: PathBuf,
    file: File,
    leftover: bool,
}

impl Setup {
    fn path_for(store_id: &str) -> Outcome<PathBuf> {
        let directory = directory_for(store_id)?;
        let path = directory.with_file_name(format!("{store_id}{SETUP_SUFFIX}"));
        ordinary_path(&path)?;
        Ok(path)
    }

    // Deny read and write sharing so a second claim fails, but allow delete
    // sharing so this handle's owner can remove the marker while holding it.
    fn open(path: &Path, create_new: bool) -> std::io::Result<File> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(create_new)
            .share_mode(FILE_SHARE_DELETE)
            .open(path)
    }

    /// Claim an unfinished setup, if one exists. `Busy` when another process
    /// is setting this identifier up right now.
    pub fn resume(store_id: &str) -> Outcome<Option<Self>> {
        let path = Self::path_for(store_id)?;
        // A marker being removed by the process that just finished its setup
        // answers "access denied" until the removal completes: still busy.
        let busy = |error: &std::io::Error| {
            is_contention(error) || error.kind() == std::io::ErrorKind::PermissionDenied
        };
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) if busy(&error) => return Err(Failure::Busy),
            Err(_) => return Err(Failure::StorageFailed("setup-marker-unavailable")),
            Ok(metadata) => {
                if !metadata.is_file() || metadata.file_attributes() & REPARSE_POINT != 0 {
                    return Err(Failure::StorageFailed("setup-marker-unavailable"));
                }
            }
        }
        match Self::open(&path, false) {
            Ok(file) => Ok(Some(Self {
                path,
                file,
                leftover: true,
            })),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) if busy(&error) => Err(Failure::Busy),
            Err(_) => Err(Failure::StorageFailed("setup-marker-unavailable")),
        }
    }

    /// Claim a new setup. The caller has already checked that no store,
    /// protector or unfinished setup exists for this identifier.
    pub fn begin(store_id: &str) -> Outcome<Self> {
        let path = Self::path_for(store_id)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| Failure::StorageFailed("directory-create-failed"))?;
        }
        match Self::open(&path, true) {
            Ok(file) => {
                file.sync_all()
                    .map_err(|_| Failure::StorageFailed("setup-marker-unavailable"))?;
                Ok(Self {
                    path,
                    file,
                    leftover: false,
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(Failure::Busy),
            Err(_) => Err(Failure::StorageFailed("setup-marker-unavailable")),
        }
    }

    /// Whether this claim took over an earlier setup that never finished.
    pub fn leftover(&self) -> bool {
        self.leftover
    }

    /// The store has been unlocked once, or nothing of the setup remains:
    /// remove the marker while still holding the claim.
    pub fn finish(self) -> Outcome<()> {
        let removed = fs::remove_file(&self.path);
        drop(self.file);
        removed.map_err(|_| Failure::StorageFailed("setup-marker-unavailable"))
    }
}

pub struct Store {
    directory: PathBuf,
    store_id: String,
    protector: Box<dyn KeyProtector>,
    fault: Fault,
}

impl Store {
    /// Create a new empty store. Refuses an existing directory.
    pub fn init(store_id: &str, protector: Box<dyn KeyProtector>) -> Outcome<Self> {
        let directory = directory_for(store_id)?;
        if directory.exists() {
            return Err(Failure::StorageFailed("exists"));
        }
        if let Some(parent) = directory.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| Failure::StorageFailed("directory-create-failed"))?;
        }
        acl::create_private_directory(&directory)?;
        let store = Self {
            directory,
            store_id: store_id.to_owned(),
            protector,
            fault: Fault::None,
        };
        let _lock = store.lock()?;
        let key = crypto::data_key()?;
        let wrapped = store.protector.wrap(&key)?;
        let header = Header {
            format: FORMAT,
            store_id: store_id.to_owned(),
            protector: store.protector.kind().to_owned(),
            wrapped_key: crypto::hex(&wrapped),
            commit: crypto::uuid_v4()?,
        };
        let plaintext = Snapshot::default().encode()?;
        let bytes = SnapshotFile::seal(header, &key, &plaintext)?.encode()?;
        atomic_commit(
            &store.snapshot_path(),
            &bytes,
            false,
            Fault::None,
            |candidate| store.verify(candidate, &key, |snapshot| snapshot.records.is_empty()),
        )?;
        Ok(store)
    }

    /// Whether a store directory exists for this identifier.
    pub fn exists(store_id: &str) -> Outcome<bool> {
        Ok(directory_for(store_id)?.is_dir())
    }

    /// Open an existing store and prove the protector can release its key.
    pub fn open(store_id: &str, protector: Box<dyn KeyProtector>) -> Outcome<Self> {
        let directory = directory_for(store_id)?;
        if !directory.is_dir() {
            return Err(Failure::StorageFailed("missing-store"));
        }
        let store = Self {
            directory,
            store_id: store_id.to_owned(),
            protector,
            fault: Fault::None,
        };
        let _lock = store.lock()?;
        store.load()?;
        Ok(store)
    }

    /// Developer harness only: inject one commit-stage fault into mutations.
    #[cfg(feature = "developer-harness")]
    pub fn with_fault(mut self, fault: Fault) -> Self {
        self.fault = fault;
        self
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    fn snapshot_path(&self) -> PathBuf {
        self.directory.join(SNAPSHOT_FILE)
    }

    // Exclusive lease for the whole operation, including readback. Another
    // holder is waited for briefly with exponential backoff; the lock file is
    // never deleted by a competing process. Abandoned handles are released by
    // the OS. Only a sharing or lock violation is treated as contention; any
    // other open error is a definite, immediate storage failure.
    fn lock(&self) -> Outcome<File> {
        lock_directory(&self.directory)
    }
}

fn lock_directory(directory: &Path) -> Outcome<File> {
    {
        let path = directory.join(LOCK_FILE);
        let start = Instant::now();
        let mut pause = LOCK_POLL_MIN;
        loop {
            match OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .share_mode(0)
                .open(&path)
            {
                Ok(file) => return Ok(file),
                Err(error) if !is_contention(&error) => {
                    return Err(Failure::StorageFailed("lock-unavailable"))
                }
                Err(_) if start.elapsed() < LOCK_WAIT => {
                    std::thread::sleep(pause);
                    pause = (pause * 2).min(LOCK_POLL_MAX);
                }
                Err(_) => return Err(Failure::Busy),
            }
        }
    }
}

impl Store {
    fn load(&self) -> Outcome<Loaded> {
        let bytes = read_bytes(&self.snapshot_path())?;
        let file = SnapshotFile::decode(&bytes)?;
        if file.header.store_id != self.store_id {
            return Err(Failure::Invalid("store-id-mismatch"));
        }
        protector::require_kind(&file.header.protector, &*self.protector)?;
        let key = self.protector.unwrap(&file.header.wrapped_key_bytes()?)?;
        let plaintext = file.open(&key)?;
        let snapshot = Snapshot::decode(&plaintext.0)?;
        Ok(Loaded {
            header: file.header,
            key,
            snapshot,
        })
    }

    fn verify(&self, bytes: &[u8], key: &Secret, check: impl Fn(&Snapshot) -> bool) -> Outcome<()> {
        let file = SnapshotFile::decode(bytes)?;
        if file.header.store_id != self.store_id {
            return Err(Failure::Invalid("store-id-mismatch"));
        }
        let snapshot = Snapshot::decode(&file.open(key)?.0)?;
        if !check(&snapshot) {
            return Err(Failure::Invalid("snapshot-state"));
        }
        Ok(())
    }

    pub fn read(&self, record_id: &str) -> Outcome<Option<Row>> {
        validate::record_id(record_id)?;
        let _lock = self.lock()?;
        Ok(self.load()?.snapshot.records.get(record_id).cloned())
    }

    pub fn create(&self, record_id: &str, data: Value) -> Outcome<String> {
        validate::record_id(record_id)?;
        validate::record_data(&data)?;
        let row = fresh_row(data)?;
        self.mutate(record_id, None, |current| {
            if current.is_some() {
                return Err(Failure::Conflict);
            }
            Ok(Some(row))
        })
    }

    pub fn edit(&self, record_id: &str, data: Value, expected_revision: &str) -> Outcome<String> {
        validate::record_id(record_id)?;
        validate::record_data(&data)?;
        validate::revision(expected_revision)?;
        let row = fresh_row(data)?;
        self.mutate(record_id, Some(expected_revision), |_| Ok(Some(row)))
    }

    pub fn edit_profile(
        &self,
        record_id: &str,
        data: Value,
        expected_revision: &str,
    ) -> Outcome<String> {
        validate::record_id(record_id)?;
        validate::profile_data(&data)?;
        validate::revision(expected_revision)?;
        let row = fresh_row(data)?;
        self.mutate(record_id, Some(expected_revision), |current| match current
            .map(|row| validate::kind_of(&row.data))
        {
            Some(Kind::Grocery | Kind::Notebook) => Err(Failure::Unsupported),
            _ => Ok(Some(row)),
        })
    }

    pub fn delete(&self, record_id: &str, expected_revision: &str) -> Outcome<String> {
        validate::record_id(record_id)?;
        validate::revision(expected_revision)?;
        self.mutate(record_id, Some(expected_revision), |_| Ok(None))?;
        Ok(expected_revision.to_owned())
    }

    // Compare under the lock, encrypt the complete next snapshot, commit it
    // atomically, and verify the committed record state by readback. Returns
    // the committed revision for upserts, or the removed revision for deletes.
    fn mutate(
        &self,
        record_id: &str,
        expected_revision: Option<&str>,
        change: impl FnOnce(Option<&Row>) -> Outcome<Option<Row>>,
    ) -> Outcome<String> {
        let _lock = self.lock()?;
        let loaded = self.load()?;
        let current = loaded.snapshot.records.get(record_id);
        if let Some(expected) = expected_revision {
            match current {
                Some(row) if row.revision == expected => {}
                _ => return Err(Failure::Conflict),
            }
        }
        let next_row = change(current)?;
        let revision = match &next_row {
            Some(row) => row.revision.clone(),
            None => expected_revision.unwrap_or_default().to_owned(),
        };
        let mut next = loaded.snapshot.clone();
        match next_row.clone() {
            Some(row) => {
                next.records.insert(record_id.to_owned(), row);
            }
            None => {
                next.records.remove(record_id);
            }
        }
        let plaintext = next.encode()?;
        let header = Header {
            commit: crypto::uuid_v4()?,
            ..loaded.header
        };
        let bytes = SnapshotFile::seal(header, &loaded.key, &plaintext)?.encode()?;
        atomic_commit(
            &self.snapshot_path(),
            &bytes,
            true,
            self.fault,
            |candidate| {
                self.verify(candidate, &loaded.key, |snapshot| {
                    snapshot.records.get(record_id) == next_row.as_ref()
                })
            },
        )?;
        Ok(revision)
    }

    /// Prove under the lock that the protector releases this store's key and
    /// the committed snapshot authenticates. Returns nothing from the snapshot.
    pub fn verify_release(&self) -> Outcome<()> {
        let _lock = self.lock()?;
        self.load().map(|_| ())
    }

    /// Developer harness only: set the commit-stage fault for later mutations.
    #[cfg(feature = "developer-harness")]
    pub fn set_fault(&mut self, fault: Fault) {
        self.fault = fault;
    }

    /// Remove this store's own files and its directory. Authenticate the
    /// snapshot and inspect every entry before deleting anything. Unknown
    /// files are retained and make cleanup fail; nothing is deleted recursively.
    pub fn cleanup(self) -> Outcome<()> {
        {
            let _lock = self.lock()?;
            let _authenticated_snapshot = self.load()?;
            remove_owned_files(&self.directory)?;
        }
        remove_lock_and_directory(&self.directory)
    }

    /// Remove a store without releasing its key: the only way to clear a
    /// store whose protector or password is lost, or a setup that was
    /// abandoned before its first unlock. The records become unrecoverable
    /// except through a separately held backup, so a caller must obtain the
    /// owner's explicit confirmation first. Every entry is inspected before
    /// anything is deleted; foreign, reparse and malformed entries are
    /// retained and make the removal fail.
    pub fn discard(store_id: &str) -> Outcome<()> {
        let directory = directory_for(store_id)?;
        if !directory.is_dir() {
            return Err(Failure::StorageFailed("missing-store"));
        }
        {
            let _lock = lock_directory(&directory)?;
            remove_owned_files(&directory)?;
        }
        remove_lock_and_directory(&directory)
    }
}

// Inspect every entry first; delete only the snapshot and exactly named
// pending files. The caller holds the lock and removes it afterwards.
fn remove_owned_files(directory: &Path) -> Outcome<()> {
    let incomplete = || Failure::StorageFailed("cleanup-incomplete");
    let mut owned = Vec::new();
    for entry in fs::read_dir(directory).map_err(|_| incomplete())? {
        let entry = entry.map_err(|_| incomplete())?;
        let name = entry.file_name();
        let name = name.to_str().ok_or_else(incomplete)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| incomplete())?;
        if !metadata.is_file() || metadata.file_attributes() & REPARSE_POINT != 0 {
            return Err(incomplete());
        }
        match name {
            LOCK_FILE => {}
            SNAPSHOT_FILE => owned.push(entry.path()),
            _ if owned_pending(name) => owned.insert(0, entry.path()),
            _ => return Err(incomplete()),
        }
    }
    // Pending files first, the committed snapshot last.
    for path in owned {
        fs::remove_file(path).map_err(|_| incomplete())?;
    }
    Ok(())
}

fn remove_lock_and_directory(directory: &Path) -> Outcome<()> {
    fs::remove_file(directory.join(LOCK_FILE))
        .map_err(|_| Failure::StorageFailed("cleanup-incomplete"))?;
    fs::remove_dir(directory).map_err(|_| Failure::StorageFailed("cleanup-incomplete"))
}

fn owned_pending(name: &str) -> bool {
    let Some(hex) = name
        .strip_prefix(PENDING_PREFIX)
        .and_then(|name| name.strip_suffix(PENDING_SUFFIX))
    else {
        return false;
    };
    hex.len() == 32
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_contention(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(ERROR_SHARING_VIOLATION) | Some(ERROR_LOCK_VIOLATION)
    )
}

fn fresh_row(data: Value) -> Outcome<Row> {
    let row = Row {
        revision: crypto::uuid_v4()?,
        data,
    };
    row.check_size()?;
    Ok(row)
}

mod acl {
    //! Create the store directory with an explicit DACL: full control for the
    //! current user and LocalSystem only, inheritance disabled. This is
    //! defense in depth under the user profile, not proof of cross-account
    //! denial; that remains an acceptance check.
    use crate::outcome::{Failure, Outcome};
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows::Win32::Security::{
        GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
        TOKEN_USER,
    };
    use windows::Win32::Storage::FileSystem::CreateDirectoryW;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    struct Token(HANDLE);
    impl Drop for Token {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn current_user_sid() -> Outcome<String> {
        let mut handle = HANDLE::default();
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) }
            .map_err(|_| Failure::StorageFailed("token-unavailable"))?;
        let token = Token(handle);
        let mut length = 0u32;
        let _ = unsafe { GetTokenInformation(token.0, TokenUser, None, 0, &mut length) };
        if length == 0 || length > 4096 {
            return Err(Failure::StorageFailed("token-unavailable"));
        }
        let mut buffer = vec![0u8; length as usize];
        unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                Some(buffer.as_mut_ptr() as *mut _),
                length,
                &mut length,
            )
        }
        .map_err(|_| Failure::StorageFailed("token-unavailable"))?;
        let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
        let mut text = PWSTR::null();
        unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) }
            .map_err(|_| Failure::StorageFailed("token-unavailable"))?;
        let sid = unsafe { text.to_string() };
        unsafe {
            let _ = LocalFree(Some(HLOCAL(text.0 as *mut _)));
        }
        let sid = sid.map_err(|_| Failure::StorageFailed("token-unavailable"))?;
        if sid.is_empty() || sid.len() > 184 || !sid.starts_with("S-1-") {
            return Err(Failure::StorageFailed("token-unavailable"));
        }
        Ok(sid)
    }

    pub(super) fn create_private_directory(path: &Path) -> Outcome<()> {
        let sid = current_user_sid()?;
        let sddl: Vec<u16> = format!("D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;{sid})")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                SDDL_REVISION_1,
                &mut descriptor,
                None,
            )
        }
        .map_err(|_| Failure::StorageFailed("directory-acl-failed"))?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: false.into(),
        };
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let created = unsafe { CreateDirectoryW(PCWSTR(wide.as_ptr()), Some(&attributes)) };
        unsafe {
            let _ = LocalFree(Some(HLOCAL(descriptor.0)));
        }
        created.map_err(|_| Failure::StorageFailed("directory-create-failed"))
    }
}

#[cfg(all(test, feature = "developer-harness"))]
mod tests {
    use super::*;
    use crate::protector::FixtureProtector;
    use serde_json::json;

    fn protector(byte: u8) -> Box<dyn KeyProtector> {
        Box::new(FixtureProtector::new([byte; 32]))
    }

    fn profile(value: &str) -> Value {
        json!({ "memberId": "alex-example", "label": "Workplace", "value": value })
    }

    fn grocery() -> Value {
        json!({ "kind": "grocery-list", "outcomes": [],
            "list": { "id": "weekly", "householdId": "home-example", "label": "Weekly", "items": [],
                "revision": "3d735c0e-3176-4502-8717-8e62f59d3a91", "updatedBy": { "kind": "human", "id": "person-example" } } })
    }

    #[test]
    fn compare_and_swap_lifecycle_round_trips_through_reopen() {
        let id = crypto::uuid_v4().unwrap();
        let store = Store::init(&id, protector(1)).unwrap();
        assert!(
            Store::init(&id, protector(1)).is_err(),
            "init refuses an existing store"
        );
        assert_eq!(store.read("alex-work").unwrap(), None);
        let first = store.create("alex-work", profile("Willow Studio")).unwrap();
        assert_eq!(
            store.create("alex-work", profile("Other")),
            Err(Failure::Conflict)
        );
        let row = store.read("alex-work").unwrap().unwrap();
        assert_eq!(
            row,
            Row {
                revision: first.clone(),
                data: profile("Willow Studio")
            }
        );
        let second = store
            .edit("alex-work", profile("Willow Studio"), &first)
            .unwrap();
        assert_ne!(
            second, first,
            "identical data still produces a fresh revision"
        );
        assert_eq!(
            store.edit("alex-work", profile("Stale"), &first),
            Err(Failure::Conflict)
        );
        assert_eq!(store.delete("alex-work", &first), Err(Failure::Conflict));
        assert_eq!(
            store.edit("missing", profile("x"), &second),
            Err(Failure::Conflict)
        );
        let grocery_revision = store.create("weekly", grocery()).unwrap();
        assert_eq!(
            store.edit_profile("weekly", profile("x"), &grocery_revision),
            Err(Failure::Unsupported)
        );
        assert_eq!(
            store.edit_profile("alex-work", grocery(), &second),
            Err(Failure::Invalid("profile-data"))
        );
        assert_eq!(store.read("weekly").unwrap().unwrap().data, grocery());

        let reopened = Store::open(&id, protector(1)).unwrap();
        assert_eq!(
            reopened.read("alex-work").unwrap().unwrap().revision,
            second
        );
        assert_eq!(reopened.delete("alex-work", &second).unwrap(), second);
        assert_eq!(reopened.read("alex-work").unwrap(), None);
        assert_eq!(
            store.edit("alex-work", profile("x"), &second),
            Err(Failure::Conflict)
        );
        let recreated = store.create("alex-work", profile("Again")).unwrap();
        assert_ne!(recreated, first);
        assert_eq!(
            store.edit("alex-work", profile("x"), &second),
            Err(Failure::Conflict)
        );

        assert!(matches!(
            Store::open(&id, protector(2)),
            Err(Failure::StorageFailed("key-release-denied"))
        ));
        assert!(matches!(
            Store::open(&crypto::uuid_v4().unwrap(), protector(1)),
            Err(Failure::StorageFailed("missing-store"))
        ));
        store.cleanup().unwrap();
        assert!(!directory_for(&id).unwrap().exists());
    }

    #[test]
    fn malformed_input_is_refused_before_storage_and_bytes_never_hold_plaintext() {
        let id = crypto::uuid_v4().unwrap();
        let store = Store::init(&id, protector(5)).unwrap();
        let revision = store
            .create("alex-work", profile("Distinctive plaintext 4471"))
            .unwrap();
        let before = read_bytes(&store.snapshot_path()).unwrap();
        for (result, reason) in [
            (store.edit("alex-work", profile("x"), "*"), "revision"),
            (
                store.edit("../outside", profile("x"), &revision),
                "record-id",
            ),
            (store.create("Alex Work", profile("x")), "record-id"),
            (
                store.edit(
                    "alex-work",
                    json!({ "memberId": "a", "label": "b", "value": "c", "extra": true }),
                    &revision,
                ),
                "record-data",
            ),
            (
                store.edit(
                    "alex-work",
                    json!({ "kind": "grocery-list", "list": { "id": "weekly" }, "outcomes": [] }),
                    &revision,
                ),
                "record-data",
            ),
        ] {
            assert_eq!(result, Err(Failure::Invalid(reason)));
        }
        let oversized = json!({ "kind": "grocery-list", "list": { "id": "weekly", "householdId": "home", "label": "Weekly",
            "items": (0..500).map(|i| json!({ "id": format!("item-{i}"), "label": "Item", "notes": "n".repeat(1000), "completed": false })).collect::<Vec<_>>(),
            "revision": "3d735c0e-3176-4502-8717-8e62f59d3a91", "updatedBy": { "kind": "human", "id": "p" } }, "outcomes": [] });
        assert_eq!(
            store.edit("alex-work", oversized, &revision),
            Err(Failure::Invalid("record-ceiling"))
        );
        assert_eq!(
            read_bytes(&store.snapshot_path()).unwrap(),
            before,
            "refused input changes no bytes"
        );
        let needle = b"Distinctive plaintext 4471";
        assert!(!before.windows(needle.len()).any(|window| window == needle));
        assert!(!before
            .windows(revision.len())
            .any(|window| window == revision.as_bytes()));
        // Tampering with the committed file is refused without overwriting it.
        let mut tampered = before.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        fs::write(store.snapshot_path(), &tampered).unwrap();
        assert!(store.read("alex-work").is_err());
        assert_eq!(
            store.edit("alex-work", profile("x"), &revision),
            Err(Failure::StorageFailed("authentication-failed"))
        );
        assert_eq!(read_bytes(&store.snapshot_path()).unwrap(), tampered);
        fs::write(store.snapshot_path(), &before).unwrap();
        assert_eq!(store.read("alex-work").unwrap().unwrap().revision, revision);
        store.cleanup().unwrap();
    }

    #[test]
    fn injected_faults_keep_old_or_new_snapshot_and_never_both() {
        let id = crypto::uuid_v4().unwrap();
        let base = Store::init(&id, protector(9)).unwrap();
        let mut revision = base.create("alex-work", profile("Original")).unwrap();
        for (fault, outcome) in [
            (Fault::BeforeWrite, "old"),
            (Fault::DuringWrite, "old"),
            (Fault::AfterWrite, "old"),
            (Fault::BeforeReplacement, "old"),
            (Fault::DiskFull, "old"),
            (Fault::TamperedTemporary, "old"),
            (Fault::AfterReplacement, "new"),
        ] {
            let faulty = Store::open(&id, protector(9)).unwrap().with_fault(fault);
            let value = format!("Fixture {fault:?}");
            let result = faulty.edit("alex-work", profile(&value), &revision);
            let row = base.read("alex-work").unwrap().unwrap();
            if outcome == "new" {
                assert!(
                    matches!(result, Err(Failure::CommitUnknown(_))),
                    "{fault:?}: {result:?}"
                );
                assert_eq!(row.data, profile(&value));
                assert_ne!(row.revision, revision);
            } else {
                assert!(
                    matches!(result, Err(Failure::StorageFailed(_))),
                    "{fault:?}: {result:?}"
                );
                assert_eq!(
                    row.revision, revision,
                    "{fault:?} must keep the old revision"
                );
            }
            revision = row.revision;
            assert_eq!(
                fs::read_dir(base.directory()).unwrap().count(),
                2,
                "{fault:?}: only snapshot and lock remain"
            );
        }
        base.cleanup().unwrap();
    }

    #[test]
    fn lock_contention_waits_then_reports_busy_while_other_open_errors_fail_at_once() {
        let id = crypto::uuid_v4().unwrap();
        let store = Store::init(&id, protector(11)).unwrap();
        let lock_path = store.directory().join(LOCK_FILE);
        // Another holder: an exclusive handle on the lock file.
        let holder = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&lock_path)
            .unwrap();
        let started = Instant::now();
        assert_eq!(store.read("alex-work"), Err(Failure::Busy));
        let waited = started.elapsed();
        assert!(
            waited >= LOCK_WAIT && waited < LOCK_WAIT + Duration::from_secs(2),
            "{waited:?}"
        );
        drop(holder);
        assert_eq!(store.read("alex-work").unwrap(), None);
        // A directory in the lock file's place is a permanent error, not contention.
        fs::remove_file(&lock_path).unwrap();
        fs::create_dir(&lock_path).unwrap();
        let started = Instant::now();
        assert_eq!(
            store.read("alex-work"),
            Err(Failure::StorageFailed("lock-unavailable"))
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        fs::remove_dir(&lock_path).unwrap();
        store.cleanup().unwrap();
    }

    #[test]
    fn cleanup_preserves_a_store_when_foreign_files_or_authentication_fail() {
        let id = crypto::uuid_v4().unwrap();
        let store = Store::init(&id, protector(12)).unwrap();
        let revision = store.create("alex-work", profile("Still here")).unwrap();
        let directory = store.directory().to_path_buf();
        let snapshot = store.snapshot_path();
        let original = read_bytes(&snapshot).unwrap();
        let foreign = directory.join("family-photo.txt");
        fs::write(&foreign, b"synthetic fixture").unwrap();

        assert_eq!(
            store.cleanup(),
            Err(Failure::StorageFailed("cleanup-incomplete"))
        );
        assert_eq!(read_bytes(&snapshot).unwrap(), original);
        assert!(foreign.exists());
        fs::remove_file(foreign).unwrap();

        let store = Store::open(&id, protector(12)).unwrap();
        assert_eq!(store.read("alex-work").unwrap().unwrap().revision, revision);
        let mut tampered = original.clone();
        *tampered.last_mut().unwrap() ^= 1;
        fs::write(&snapshot, &tampered).unwrap();
        assert_eq!(
            store.cleanup(),
            Err(Failure::StorageFailed("authentication-failed"))
        );
        assert_eq!(read_bytes(&snapshot).unwrap(), tampered);

        fs::write(&snapshot, original).unwrap();
        let pending = directory.join("snapshot-0123456789abcdef0123456789abcdef.pending");
        fs::write(&pending, b"synthetic interrupted write").unwrap();
        Store::open(&id, protector(12)).unwrap().cleanup().unwrap();
        assert!(!directory.exists());
    }

    #[test]
    fn a_setup_claim_is_exclusive_survives_a_crash_and_is_cleared_only_by_finish() {
        let id = crypto::uuid_v4().unwrap();
        assert!(Setup::resume(&id).unwrap().is_none());
        let setup = Setup::begin(&id).unwrap();
        assert!(!setup.leftover());
        // While the claim is held nobody else can begin or take it over.
        assert_eq!(Setup::begin(&id).err(), Some(Failure::Busy));
        assert_eq!(Setup::resume(&id).err(), Some(Failure::Busy));
        // The process dies before the first unlock: the claim is released but
        // the marker stays as the record of an unfinished setup.
        drop(setup);
        assert_eq!(Setup::begin(&id).err(), Some(Failure::Busy));
        let resumed = Setup::resume(&id).unwrap().expect("unfinished setup");
        assert!(resumed.leftover());
        resumed.finish().unwrap();
        assert!(Setup::resume(&id).unwrap().is_none());
        Setup::begin(&id).unwrap().finish().unwrap();
        assert_eq!(
            Setup::begin("not-a-uuid").err(),
            Some(Failure::Invalid("store-id"))
        );
    }

    #[test]
    fn discard_removes_a_store_without_its_key_and_refuses_foreign_entries() {
        let id = crypto::uuid_v4().unwrap();
        assert_eq!(Store::exists(&id), Ok(false));
        assert_eq!(
            Store::discard(&id),
            Err(Failure::StorageFailed("missing-store"))
        );
        let store = Store::init(&id, protector(21)).unwrap();
        store.create("alex-work", profile("Unreachable")).unwrap();
        let directory = store.directory().to_path_buf();
        drop(store);
        assert_eq!(Store::exists(&id), Ok(true));
        let foreign = directory.join("family-photo.txt");
        fs::write(&foreign, b"synthetic fixture").unwrap();
        assert_eq!(
            Store::discard(&id),
            Err(Failure::StorageFailed("cleanup-incomplete"))
        );
        assert!(
            directory.join(SNAPSHOT_FILE).exists(),
            "nothing was deleted"
        );
        fs::remove_file(foreign).unwrap();
        fs::write(
            directory.join("snapshot-0123456789abcdef0123456789abcdef.pending"),
            b"synthetic interrupted write",
        )
        .unwrap();
        Store::discard(&id).unwrap();
        assert!(!directory.exists());
        assert_eq!(Store::exists(&id), Ok(false));
    }

    #[test]
    fn store_directory_is_derived_from_a_canonical_identifier_only() {
        assert_eq!(
            directory_for("not-a-uuid"),
            Err(Failure::Invalid("store-id"))
        );
        assert_eq!(
            directory_for("3D735C0E-3176-4502-8717-8E62F59D3A91"),
            Err(Failure::Invalid("store-id"))
        );
        let directory = directory_for("3d735c0e-3176-4502-8717-8e62f59d3a91").unwrap();
        assert!(directory.ends_with(
            Path::new("LunaOSHome")
                .join("SnapshotStores")
                .join("3d735c0e-3176-4502-8717-8e62f59d3a91")
        ));
    }
}
