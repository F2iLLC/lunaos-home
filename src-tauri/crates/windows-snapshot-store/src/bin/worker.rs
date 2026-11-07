//! Local stdin/stdout worker: one bounded JSON request per process, one JSON
//! response line. Not a network API. The Node adapter in
//! `lib/windows-snapshot-store.js` is its only intended caller.
//!
//! Failures print `{ "ok": false, "error": CODE }` plus a static `reason`
//! identifier for every code except `CONFLICT` and `UNSUPPORTED`. No path,
//! record value, revision or OS diagnostic appears in a failure.
#[cfg(target_os = "windows")]
mod worker {
    use lunaos_home_windows_snapshot_store::fault::Fault;
    use lunaos_home_windows_snapshot_store::protector::KeyProtector;
    use lunaos_home_windows_snapshot_store::store::Store;
    use lunaos_home_windows_snapshot_store::{Failure, Outcome};
    use serde_json::{json, Map, Value};
    use std::io::{Read, Write};

    const MAX_INPUT: usize = 1_048_576;

    pub(super) fn run() {
        let mut input = Vec::new();
        let read = std::io::stdin()
            .lock()
            .take(MAX_INPUT as u64 + 1)
            .read_to_end(&mut input);
        let result = match read {
            Ok(_) => handle(&input),
            Err(_) => Err(Failure::Invalid("input-unavailable")),
        };
        let (code, response) = match result {
            Ok(mut response) => {
                response.insert("ok".into(), Value::Bool(true));
                (0, Value::Object(response))
            }
            Err(failure) => {
                let mut response = Map::new();
                response.insert("ok".into(), Value::Bool(false));
                response.insert("error".into(), Value::String(failure.code().into()));
                if let Some(reason) = failure.reason() {
                    response.insert("reason".into(), Value::String(reason.into()));
                }
                (1, Value::Object(response))
            }
        };
        let mut stdout = std::io::stdout().lock();
        let _ = stdout.write_all(response.to_string().as_bytes());
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
        std::process::exit(code);
    }

    fn text<'a>(object: &'a Map<String, Value>, key: &str) -> Outcome<&'a str> {
        object
            .get(key)
            .and_then(Value::as_str)
            .ok_or(Failure::Invalid("request"))
    }

    fn protector_from(value: Option<&Value>) -> Outcome<Box<dyn KeyProtector>> {
        let object = value
            .and_then(Value::as_object)
            .ok_or(Failure::Invalid("protector"))?;
        let kind = text(object, "kind").map_err(|_| Failure::Invalid("protector"))?;
        #[cfg(feature = "developer-harness")]
        if kind == "fixture" && object.len() == 2 {
            use lunaos_home_windows_snapshot_store::crypto::unhex;
            use lunaos_home_windows_snapshot_store::protector::FixtureProtector;
            let key = text(object, "key").map_err(|_| Failure::Invalid("protector"))?;
            let bytes = unhex(key).ok_or(Failure::Invalid("protector"))?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| Failure::Invalid("protector"))?;
            return Ok(Box::new(FixtureProtector::new(key)));
        }
        let _ = kind;
        Err(Failure::Invalid("protector-unavailable"))
    }

    fn fault_from(value: Option<&Value>) -> Outcome<Fault> {
        match value {
            None => Ok(Fault::None),
            #[cfg(feature = "developer-harness")]
            Some(value) => value
                .as_str()
                .and_then(Fault::parse)
                .ok_or(Failure::Invalid("test-fault")),
            #[cfg(not(feature = "developer-harness"))]
            Some(_) => Err(Failure::Invalid("test-fault-unavailable")),
        }
    }

    fn handle(input: &[u8]) -> Outcome<Map<String, Value>> {
        if input.len() > MAX_INPUT {
            return Err(Failure::Invalid("input-size"));
        }
        let request: Value =
            serde_json::from_slice(input).map_err(|_| Failure::Invalid("request"))?;
        let object = request.as_object().ok_or(Failure::Invalid("request"))?;
        let operation = text(object, "operation")?;
        let store_id = text(object, "storeId")?;
        let protector = protector_from(object.get("protector"))?;
        let fault = fault_from(object.get("testFault"))?;
        let mutation = matches!(operation, "create" | "edit" | "edit-profile" | "delete");
        if fault != Fault::None && !mutation {
            return Err(Failure::Invalid("test-fault"));
        }
        let mut expected = 3 + usize::from(object.contains_key("testFault"));
        expected += match operation {
            "init" | "open" | "cleanup" => 0,
            "read" => 1,
            "create" => 2,
            "edit" | "edit-profile" => 3,
            "delete" => 2,
            _ => return Err(Failure::Invalid("operation")),
        };
        if object.len() != expected {
            return Err(Failure::Invalid("request"));
        }
        let mut response = Map::new();
        match operation {
            "init" => {
                let store = Store::init(store_id, protector)?;
                response.insert("directory".into(), directory(&store));
            }
            "open" => {
                let store = Store::open(store_id, protector)?;
                response.insert("directory".into(), directory(&store));
            }
            "cleanup" => Store::open(store_id, protector)?.cleanup()?,
            "read" => {
                let store = Store::open(store_id, protector)?;
                let row = store.read(text(object, "recordId")?)?;
                response.insert(
                    "data".into(),
                    match row {
                        None => Value::Null,
                        Some(row) => json!({ "revision": row.revision, "data": row.data }),
                    },
                );
            }
            _ => {
                let store = open_with_fault(store_id, protector, fault)?;
                let record_id = text(object, "recordId")?;
                let data = || {
                    object
                        .get("data")
                        .cloned()
                        .ok_or(Failure::Invalid("request"))
                };
                let revision = match operation {
                    "create" => store.create(record_id, data()?)?,
                    "edit" => store.edit(record_id, data()?, text(object, "expectedRevision")?)?,
                    "edit-profile" => {
                        store.edit_profile(record_id, data()?, text(object, "expectedRevision")?)?
                    }
                    _ => store.delete(record_id, text(object, "expectedRevision")?)?,
                };
                response.insert("revision".into(), Value::String(revision));
            }
        }
        Ok(response)
    }

    fn open_with_fault(
        store_id: &str,
        protector: Box<dyn KeyProtector>,
        fault: Fault,
    ) -> Outcome<Store> {
        let store = Store::open(store_id, protector)?;
        #[cfg(feature = "developer-harness")]
        {
            Ok(store.with_fault(fault))
        }
        #[cfg(not(feature = "developer-harness"))]
        {
            debug_assert_eq!(fault, Fault::None);
            Ok(store)
        }
    }

    // Privileged local metadata for the developer adapter and its tests. It is
    // never returned through a Home session, MCP tool or failure response.
    fn directory(store: &Store) -> Value {
        Value::String(store.directory().to_string_lossy().into_owned())
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    worker::run();
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("WindowsSnapshotFileStore requires Windows.");
        std::process::exit(2);
    }
}
