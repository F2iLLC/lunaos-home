//! Local stdin/stdout worker. Not a network API. The Node adapter in
//! `lib/windows-snapshot-store.js` is its only intended caller.
//!
//! Without arguments it serves one bounded JSON request per process and
//! prints one JSON response line (developer harness: fixture protector only).
//!
//! With the single argument `--session` it serves one unlock session: a start
//! line, then one JSON request per line until the session is locked or ends.
//! This is the only mode that accepts the Software KSP protector, because the
//! Windows key-password gesture happens once per session, not once per
//! request. The process is the session: when it exits, the vault is locked.
//!
//! Failures print `{ "ok": false, "error": CODE }` plus a static `reason`
//! identifier for every code except `CONFLICT` and `UNSUPPORTED`. No path,
//! record value, revision or OS diagnostic appears in a failure.
#[cfg(target_os = "windows")]
mod worker {
    use lunaos_home_windows_snapshot_store::fault::Fault;
    use lunaos_home_windows_snapshot_store::ksp::SoftwareKspProtector;
    use lunaos_home_windows_snapshot_store::owner::{self, Clock, Limits, Phase, Presentation};
    use lunaos_home_windows_snapshot_store::protector::KeyProtector;
    use lunaos_home_windows_snapshot_store::store::Store;
    use lunaos_home_windows_snapshot_store::{Failure, Outcome};
    use serde_json::{json, Map, Value};
    use std::io::{BufRead, BufReader, Read, Stdin, Write};
    use std::sync::Arc;
    use windows::core::w;

    const MAX_INPUT: usize = 1_048_576;

    pub(super) fn run() {
        let arguments: Vec<String> = std::env::args().skip(1).collect();
        match arguments.as_slice() {
            [] => one_shot(),
            [flag] if flag == "--session" => session(),
            _ => std::process::exit(2),
        }
    }

    fn emit(value: &Value) {
        let mut line = value.to_string();
        line.push('\n');
        let mut stdout = std::io::stdout().lock();
        let _ = stdout.write_all(line.as_bytes());
        let _ = stdout.flush();
    }

    fn failure_response(failure: Failure) -> Map<String, Value> {
        let mut response = Map::new();
        response.insert("ok".into(), Value::Bool(false));
        response.insert("error".into(), Value::String(failure.code().into()));
        if let Some(reason) = failure.reason() {
            response.insert("reason".into(), Value::String(reason.into()));
        }
        response
    }

    fn one_shot() {
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
                (0, response)
            }
            Err(failure) => (1, failure_response(failure)),
        };
        emit(&Value::Object(response));
        std::process::exit(code);
    }

    fn text<'a>(object: &'a Map<String, Value>, key: &str) -> Outcome<&'a str> {
        object
            .get(key)
            .and_then(Value::as_str)
            .ok_or(Failure::Invalid("request"))
    }

    enum Protector {
        #[cfg(feature = "developer-harness")]
        Fixture([u8; 32]),
        SoftwareKsp,
    }

    fn protector_kind(value: Option<&Value>) -> Outcome<Protector> {
        let object = value
            .and_then(Value::as_object)
            .ok_or(Failure::Invalid("protector"))?;
        let kind = text(object, "kind").map_err(|_| Failure::Invalid("protector"))?;
        #[cfg(feature = "developer-harness")]
        if kind == "fixture" && object.len() == 2 {
            use lunaos_home_windows_snapshot_store::crypto::unhex;
            let key = text(object, "key").map_err(|_| Failure::Invalid("protector"))?;
            let bytes = unhex(key).ok_or(Failure::Invalid("protector"))?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| Failure::Invalid("protector"))?;
            return Ok(Protector::Fixture(key));
        }
        if kind == "software-ksp" && object.len() == 1 {
            return Ok(Protector::SoftwareKsp);
        }
        Err(Failure::Invalid("protector-unavailable"))
    }

    // One request per process cannot carry the Software KSP protector: every
    // process would ask for the vault password again.
    fn one_shot_protector(value: Option<&Value>) -> Outcome<Box<dyn KeyProtector>> {
        match protector_kind(value)? {
            #[cfg(feature = "developer-harness")]
            Protector::Fixture(key) => {
                use lunaos_home_windows_snapshot_store::protector::FixtureProtector;
                Ok(Box::new(FixtureProtector::new(key)))
            }
            Protector::SoftwareKsp => Err(Failure::Invalid("protector-requires-session")),
        }
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

    fn is_mutation(operation: &str) -> bool {
        matches!(operation, "create" | "edit" | "edit-profile" | "delete")
    }

    // Number of operation-specific fields, or a refusal for an unknown name.
    fn operand_count(operation: &str) -> Outcome<usize> {
        Ok(match operation {
            "read" => 1,
            "create" => 2,
            "edit" | "edit-profile" => 3,
            "delete" => 2,
            _ => return Err(Failure::Invalid("operation")),
        })
    }

    // The record operations shared by both modes.
    fn perform(
        store: &Store,
        operation: &str,
        object: &Map<String, Value>,
        response: &mut Map<String, Value>,
    ) -> Outcome<()> {
        let record_id = text(object, "recordId")?;
        if operation == "read" {
            let row = store.read(record_id)?;
            response.insert(
                "data".into(),
                match row {
                    None => Value::Null,
                    Some(row) => json!({ "revision": row.revision, "data": row.data }),
                },
            );
            return Ok(());
        }
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
            "delete" => store.delete(record_id, text(object, "expectedRevision")?)?,
            _ => return Err(Failure::Invalid("operation")),
        };
        response.insert("revision".into(), Value::String(revision));
        Ok(())
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
        // Developer harness only: clear a fictional store whose disposable
        // key or password is gone, without any key release.
        #[cfg(feature = "developer-harness")]
        if operation == "discard" {
            if object.len() != 3 {
                return Err(Failure::Invalid("request"));
            }
            let ksp = matches!(
                protector_kind(object.get("protector"))?,
                Protector::SoftwareKsp
            );
            match Store::discard(store_id) {
                Ok(()) | Err(Failure::StorageFailed("missing-store")) => {}
                Err(failure) => return Err(failure),
            }
            if ksp {
                SoftwareKspProtector::delete(store_id)?;
            }
            return Ok(Map::new());
        }
        let protector = one_shot_protector(object.get("protector"))?;
        let fault = fault_from(object.get("testFault"))?;
        if fault != Fault::None && !is_mutation(operation) {
            return Err(Failure::Invalid("test-fault"));
        }
        let mut expected = 3 + usize::from(object.contains_key("testFault"));
        expected += match operation {
            "init" | "open" | "cleanup" => 0,
            other => operand_count(other)?,
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
            _ => {
                let store = open_with_fault(store_id, protector, fault)?;
                perform(&store, operation, object, &mut response)?;
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

    // ---- Session mode -----------------------------------------------------

    struct Start {
        store_id: String,
        create: bool,
        protector: Protector,
        limits: Limits,
    }

    // Read one newline-terminated request of bounded size. `None` is a closed
    // pipe: the parent is gone, so the session ends.
    fn read_line(reader: &mut BufReader<Stdin>) -> Outcome<Option<Vec<u8>>> {
        let mut line = Vec::new();
        let read = reader
            .by_ref()
            .take(MAX_INPUT as u64 + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| Failure::Invalid("input-unavailable"))?;
        if read == 0 {
            return Ok(None);
        }
        if line.last() != Some(&b'\n') {
            // Oversized, or the pipe closed mid-request: never act on it.
            return Err(Failure::Invalid("input-size"));
        }
        line.pop();
        Ok(Some(line))
    }

    #[cfg(feature = "developer-harness")]
    fn limit_override(
        object: &Map<String, Value>,
        key: &str,
        fallback: std::time::Duration,
    ) -> Outcome<std::time::Duration> {
        match object.get(key) {
            None => Ok(fallback),
            Some(value) => value
                .as_u64()
                .filter(|milliseconds| (50..=3_600_000).contains(milliseconds))
                .map(std::time::Duration::from_millis)
                .ok_or(Failure::Invalid("test-limit")),
        }
    }

    fn parse_start(line: &[u8]) -> Outcome<Start> {
        let request: Value =
            serde_json::from_slice(line).map_err(|_| Failure::Invalid("request"))?;
        let object = request.as_object().ok_or(Failure::Invalid("request"))?;
        let create = match text(object, "operation")? {
            "session-create" => true,
            "session-open" => false,
            _ => return Err(Failure::Invalid("operation")),
        };
        let store_id = text(object, "storeId")?.to_owned();
        let protector = protector_kind(object.get("protector"))?;
        #[allow(unused_mut)]
        let mut limits = Limits::default();
        #[allow(unused_mut)]
        let mut expected = 3;
        // The limits are fixed in a default build. Only the developer harness
        // may shorten them, to exercise expiry without waiting minutes.
        #[cfg(feature = "developer-harness")]
        {
            limits.idle = limit_override(object, "testIdleMs", limits.idle)?;
            limits.lifetime = limit_override(object, "testLifetimeMs", limits.lifetime)?;
            expected += usize::from(object.contains_key("testIdleMs"))
                + usize::from(object.contains_key("testLifetimeMs"));
        }
        if object.len() != expected {
            return Err(Failure::Invalid("request"));
        }
        Ok(Start {
            store_id,
            create,
            protector,
            limits,
        })
    }

    fn end(reason: &'static str) -> ! {
        emit(&json!({ "event": "ended", "reason": reason }));
        std::process::exit(3)
    }

    fn session() {
        let mut reader = BufReader::new(std::io::stdin());
        let start = match read_line(&mut reader) {
            Ok(Some(line)) => parse_start(&line),
            Ok(None) => Err(Failure::Invalid("input-unavailable")),
            Err(failure) => Err(failure),
        };
        let start = match start {
            Ok(start) => start,
            Err(failure) => {
                emit(&Value::Object(failure_response(failure)));
                std::process::exit(1);
            }
        };
        // Refuse a missing or duplicate key before any window appears.
        if matches!(start.protector, Protector::SoftwareKsp) {
            let refusal = match SoftwareKspProtector::exists(&start.store_id) {
                Ok(true) if start.create => Some(Failure::StorageFailed("protector-exists")),
                Ok(false) if !start.create => Some(Failure::StorageFailed("protector-missing")),
                Ok(_) => None,
                Err(failure) => Some(failure),
            };
            if let Some(failure) = refusal {
                emit(&Value::Object(failure_response(failure)));
                std::process::exit(1);
            }
        }
        let presentation = match start.protector {
            Protector::SoftwareKsp => Presentation::Visible,
            #[cfg(feature = "developer-harness")]
            Protector::Fixture(_) => Presentation::Hidden,
        };
        let limits = start.limits;
        match owner::run(presentation, limits, end, move |window, clock| {
            serve(window, clock, start, reader)
        }) {
            Ok(code) => std::process::exit(code),
            Err(_) => {
                emit(&Value::Object(failure_response(Failure::StorageFailed(
                    "session-unavailable",
                ))));
                std::process::exit(1);
            }
        }
    }

    // Unlock: build the protector, open or create the store, and prove the
    // key is released before the session reports ready. A create that cannot
    // complete its first unlock is rolled back so setup can be repeated.
    fn unlock(window: isize, start: &Start) -> Outcome<Store> {
        let ksp = matches!(start.protector, Protector::SoftwareKsp);
        let protector: Box<dyn KeyProtector> = match start.protector {
            Protector::SoftwareKsp => Box::new(if start.create {
                SoftwareKspProtector::enroll(&start.store_id, window)?
            } else {
                SoftwareKspProtector::open(&start.store_id, window)?
            }),
            #[cfg(feature = "developer-harness")]
            Protector::Fixture(key) => {
                use lunaos_home_windows_snapshot_store::protector::FixtureProtector;
                Box::new(FixtureProtector::new(key))
            }
        };
        if !start.create {
            return Store::open(&start.store_id, protector);
        }
        let created = Store::init(&start.store_id, protector);
        let verified = match created {
            Ok(store) => match store.verify_release() {
                Ok(()) => return Ok(store),
                Err(failure) => {
                    drop(store);
                    let _ = Store::discard(&start.store_id);
                    Err(failure)
                }
            },
            // Nothing of this setup exists on disk; an earlier store with the
            // same identifier, if any, is left exactly as it was.
            Err(failure) => Err(failure),
        };
        if ksp {
            let _ = SoftwareKspProtector::delete(&start.store_id);
        }
        verified
    }

    fn serve(window: isize, clock: Arc<Clock>, start: Start, mut reader: BufReader<Stdin>) -> i32 {
        #[allow(unused_mut)]
        let mut store = match unlock(window, &start) {
            Ok(store) => store,
            Err(failure) => {
                emit(&Value::Object(failure_response(failure)));
                return 1;
            }
        };
        if matches!(start.protector, Protector::SoftwareKsp) {
            owner::set_title(
                window,
                w!("Luna OS Home vault is unlocked - close this window to lock it"),
            );
            owner::minimize(window);
        }
        clock.enter(Phase::Idle);
        #[allow(unused_mut)]
        let mut ready = json!({ "ok": true, "session": "unlocked" });
        #[cfg(feature = "developer-harness")]
        ready
            .as_object_mut()
            .expect("object")
            .insert("directory".into(), directory(&store));
        emit(&ready);
        loop {
            let line = match read_line(&mut reader) {
                Ok(Some(line)) => line,
                // The parent closed the pipe or sent an unusable request
                // stream: lock rather than guess.
                Ok(None) => return 0,
                Err(_) => return 1,
            };
            clock.enter(Phase::Busy);
            let (id, outcome) = request(&mut store, &start, &line);
            let (mut response, stop) = match outcome {
                Ok(Reply::Done(response)) => (response, false),
                Ok(Reply::Lock(response)) => (response, true),
                Err(failure) => (failure_response(failure), false),
            };
            if !response.contains_key("ok") {
                response.insert("ok".into(), Value::Bool(true));
            }
            response.insert("id".into(), id);
            emit(&Value::Object(response));
            if stop {
                return 0;
            }
            clock.enter(Phase::Idle);
        }
    }

    enum Reply {
        Done(Map<String, Value>),
        Lock(Map<String, Value>),
    }

    fn request(store: &mut Store, start: &Start, line: &[u8]) -> (Value, Outcome<Reply>) {
        let parsed: Option<Value> = serde_json::from_slice(line).ok();
        let Some(object) = parsed.as_ref().and_then(Value::as_object) else {
            return (Value::Null, Err(Failure::Invalid("request")));
        };
        let id = match object.get("id") {
            Some(Value::Number(number)) if number.is_u64() => Value::Number(number.clone()),
            _ => return (Value::Null, Err(Failure::Invalid("request"))),
        };
        let outcome = (|| {
            let operation = text(object, "operation")?;
            let fault = fault_from(object.get("testFault"))?;
            if fault != Fault::None && !is_mutation(operation) {
                return Err(Failure::Invalid("test-fault"));
            }
            let base = 2 + usize::from(object.contains_key("testFault"));
            let mut response = Map::new();
            match operation {
                "lock" => {
                    if object.len() != base {
                        return Err(Failure::Invalid("request"));
                    }
                    response.insert("session".into(), Value::String("locked".into()));
                    return Ok(Reply::Lock(response));
                }
                // Developer harness only: remove the fictional store and, for
                // the Software KSP protector, its disposable key.
                #[cfg(feature = "developer-harness")]
                "destroy" => {
                    if object.len() != base {
                        return Err(Failure::Invalid("request"));
                    }
                    Store::discard(&start.store_id)?;
                    if matches!(start.protector, Protector::SoftwareKsp) {
                        SoftwareKspProtector::delete(&start.store_id)?;
                    }
                    response.insert("session".into(), Value::String("destroyed".into()));
                    return Ok(Reply::Lock(response));
                }
                _ => {}
            }
            if object.len() != base + operand_count(operation)? {
                return Err(Failure::Invalid("request"));
            }
            #[cfg(feature = "developer-harness")]
            store.set_fault(fault);
            perform(store, operation, object, &mut response)?;
            Ok(Reply::Done(response))
        })();
        let _ = start;
        (id, outcome)
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
