use super::*;

#[test]
fn valid_fixture_states_round_trip() {
    for snapshot in [
        Snapshot::initial(),
        Snapshot {
            revision: 2,
            record: UPDATED_FIXTURE_RECORD.into(),
            last_request: Some("a".repeat(32)),
            receipt_revision: Some(2),
        },
    ] {
        assert_eq!(
            Snapshot::decode(&snapshot.encode(), snapshot.revision),
            Ok(snapshot)
        );
    }
}

#[test]
fn canonical_parsing_does_not_accept_invalid_fixture_states() {
    let updated = Snapshot {
        revision: 2,
        record: UPDATED_FIXTURE_RECORD.into(),
        last_request: Some("a".repeat(32)),
        receipt_revision: Some(2),
    };
    let mut cases = vec![];
    let mut unknown_record = Snapshot::initial();
    unknown_record.record = "Fictional unsupported record".into();
    cases.push(unknown_record);
    for revision in [0, 2] {
        cases.push(Snapshot {
            revision,
            ..Snapshot::initial()
        });
    }
    cases.push(Snapshot {
        receipt_revision: Some(3),
        ..updated.clone()
    });
    cases.push(Snapshot {
        last_request: None,
        receipt_revision: None,
        ..updated.clone()
    });
    cases.push(Snapshot {
        revision: 1,
        receipt_revision: Some(1),
        ..updated.clone()
    });
    cases.push(Snapshot {
        record: FIXTURE_RECORD.into(),
        ..updated
    });
    for snapshot in cases {
        let bytes = snapshot.encode();
        assert_eq!(Snapshot::parse(&bytes), Ok(snapshot.clone()));
        assert_eq!(
            Snapshot::decode(&bytes, snapshot.revision),
            Err("snapshot-invalid")
        );
    }
    assert_eq!(
        Snapshot::decode(&Snapshot::initial().encode(), 2),
        Err("snapshot-invalid")
    );
}

#[test]
fn malformed_and_noncanonical_wire_formats_are_rejected() {
    let initial = String::from_utf8(Snapshot::initial().encode()).unwrap();
    for bytes in [
        vec![0xff],
        initial.trim_end().as_bytes().to_vec(),
        initial.replacen("\n1\n", "\n01\n", 1).into_bytes(),
        initial
            .replace(SNAPSHOT_MAGIC, "unsupported-version")
            .into_bytes(),
        initial.replace("\n-\n-\n", "\n-\n1\n").into_bytes(),
        initial
            .replace("\n-\n-\n", &format!("\n{}\n-\n", "a".repeat(32)))
            .into_bytes(),
        initial
            .replace("\n-\n-\n", &format!("\n{}\n1\n", "g".repeat(32)))
            .into_bytes(),
    ] {
        assert_eq!(Snapshot::parse(&bytes), Err("snapshot-invalid"));
        assert_eq!(Snapshot::decode(&bytes, 1), Err("snapshot-invalid"));
    }
}
