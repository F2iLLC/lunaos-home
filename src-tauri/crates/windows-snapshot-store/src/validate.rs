//! Native-side bounds and shape checks. These mirror the shared JavaScript
//! contract in `lib/vault-record-contract.js` closely enough to refuse
//! malformed input before any storage access (clause C-13). The complete
//! field-level schema remains the shared Zod contract at the adapter boundary.
use crate::outcome::{Failure, Outcome};
use serde_json::Value;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Profile,
    Grocery,
}

fn is_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn record_id(value: &str) -> Outcome<()> {
    if is_id(value) {
        Ok(())
    } else {
        Err(Failure::Invalid("record-id"))
    }
}

/// Canonical lowercase UUID of any version.
pub fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase(),
        })
}

/// Canonical lowercase UUID v4 change token.
pub fn revision(value: &str) -> Outcome<()> {
    let bytes = value.as_bytes();
    if is_uuid(value) && bytes[14] == b'4' && matches!(bytes[19], b'8' | b'9' | b'a' | b'b') {
        Ok(())
    } else {
        Err(Failure::Invalid("revision"))
    }
}

fn bounded_text(value: Option<&Value>, max_chars: usize) -> bool {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            !trimmed.is_empty() && text.chars().count() <= max_chars
        }
        _ => false,
    }
}

fn object_with_keys<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    let object = value.as_object()?;
    if object.len() != keys.len() || !keys.iter().all(|key| object.contains_key(*key)) {
        return None;
    }
    Some(object)
}

fn profile_shape(value: &Value) -> bool {
    match object_with_keys(value, &["memberId", "label", "value"]) {
        Some(object) => {
            matches!(object.get("memberId"), Some(Value::String(id)) if is_id(id))
                && bounded_text(object.get("label"), 80)
                && bounded_text(object.get("value"), 240)
        }
        None => false,
    }
}

fn grocery_shape(value: &Value) -> bool {
    let Some(object) = object_with_keys(value, &["kind", "list", "outcomes"]) else {
        return false;
    };
    if object.get("kind") != Some(&Value::String("grocery-list".into())) {
        return false;
    }
    let Some(list) = object.get("list").and_then(|list| {
        object_with_keys(
            list,
            &[
                "id",
                "householdId",
                "label",
                "items",
                "revision",
                "updatedBy",
            ],
        )
    }) else {
        return false;
    };
    let ids_ok = ["id", "householdId"]
        .iter()
        .all(|key| matches!(list.get(*key), Some(Value::String(id)) if is_id(id)));
    let items_ok = matches!(list.get("items"), Some(Value::Array(items)) if items.len() <= 500);
    let revision_ok = matches!(list.get("revision"), Some(Value::String(r)) if revision(r).is_ok());
    let outcomes_ok =
        matches!(object.get("outcomes"), Some(Value::Array(outcomes)) if outcomes.len() <= 512);
    ids_ok && items_ok && revision_ok && bounded_text(list.get("label"), 120) && outcomes_ok
}

/// Accept either record kind for `create` and `edit`.
pub fn record_data(value: &Value) -> Outcome<Kind> {
    if profile_shape(value) {
        Ok(Kind::Profile)
    } else if grocery_shape(value) {
        Ok(Kind::Grocery)
    } else {
        Err(Failure::Invalid("record-data"))
    }
}

/// Accept only the bounded profile record for `editProfile`. Grocery data on
/// this path is invalid input, not a conflict.
pub fn profile_data(value: &Value) -> Outcome<()> {
    if profile_shape(value) {
        Ok(())
    } else {
        Err(Failure::Invalid("profile-data"))
    }
}

pub fn kind_of(value: &Value) -> Kind {
    if value.get("kind") == Some(&Value::String("grocery-list".into())) {
        Kind::Grocery
    } else {
        Kind::Profile
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn grocery() -> Value {
        json!({ "kind": "grocery-list", "outcomes": [],
            "list": { "id": "weekly", "householdId": "home-example", "label": "Weekly", "items": [],
                "revision": "3d735c0e-3176-4502-8717-8e62f59d3a91", "updatedBy": { "kind": "human", "id": "person-example" } } })
    }

    #[test]
    fn identifiers_and_revisions_are_bounded_and_canonical() {
        assert!(record_id("alex-work").is_ok());
        assert!(record_id("Alex_Work-1").is_ok());
        assert!(record_id("").is_err());
        assert!(record_id("Alex Work").is_err());
        assert!(record_id("../outside").is_err());
        assert!(record_id(&"a".repeat(81)).is_err());
        assert!(revision("3d735c0e-3176-4502-8717-8e62f59d3a91").is_ok());
        assert!(revision("3D735C0E-3176-4502-8717-8E62F59D3A91").is_err());
        assert!(revision("3d735c0e-3176-1502-8717-8e62f59d3a91").is_err());
        assert!(revision("not-a-revision").is_err());
        assert!(is_uuid("3d735c0e-3176-1502-8717-8e62f59d3a91"));
    }

    #[test]
    fn record_shapes_are_refused_before_storage() {
        let profile =
            json!({ "memberId": "alex-example", "label": "Workplace", "value": "Willow Studio" });
        assert_eq!(record_data(&profile), Ok(Kind::Profile));
        assert!(profile_data(&profile).is_ok());
        assert_eq!(record_data(&grocery()), Ok(Kind::Grocery));
        assert_eq!(
            profile_data(&grocery()),
            Err(Failure::Invalid("profile-data"))
        );
        assert_eq!(kind_of(&grocery()), Kind::Grocery);
        assert_eq!(kind_of(&profile), Kind::Profile);
        for bad in [
            json!({ "memberId": "alex-example", "label": "Workplace", "value": "Willow Studio", "extra": true }),
            json!({ "memberId": "alex example", "label": "Workplace", "value": "Willow Studio" }),
            json!({ "memberId": "alex-example", "label": "   ", "value": "Willow Studio" }),
            json!({ "memberId": "alex-example", "label": "Workplace", "value": "v".repeat(241) }),
            json!({ "kind": "grocery-list", "list": { "id": "weekly" }, "outcomes": [] }),
            json!("text"),
            json!(null),
            json!([]),
        ] {
            assert_eq!(
                record_data(&bad),
                Err(Failure::Invalid("record-data")),
                "{bad}"
            );
        }
    }
}
