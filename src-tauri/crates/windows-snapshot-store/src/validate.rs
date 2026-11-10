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
    Notebook,
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

/// Only the named keys, with every key in `required` present.
fn object_within<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    let object = value.as_object()?;
    let known = object
        .keys()
        .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str()));
    (known && required.iter().all(|key| object.contains_key(*key))).then_some(object)
}

/// Attribution from the vault session: who last changed a list or item.
fn actor_or_absent(value: Option<&Value>) -> bool {
    let Some(value) = value else {
        return true;
    };
    match object_with_keys(value, &["kind", "id"]) {
        Some(actor) => {
            matches!(actor.get("kind"), Some(Value::String(kind)) if kind == "human" || kind == "assistant")
                && matches!(actor.get("id"), Some(Value::String(id)) if is_id(id))
        }
        None => false,
    }
}

fn notebook_item_shape(value: &Value) -> bool {
    let Some(item) = object_within(
        value,
        &[
            "id",
            "text",
            "completed",
            "position",
            "createdAt",
            "updatedAt",
        ],
        &["quantity", "unit", "notes", "category", "updatedBy"],
    ) else {
        return false;
    };
    if !actor_or_absent(item.get("updatedBy")) {
        return false;
    }
    matches!(item.get("id"), Some(Value::String(id)) if is_id(id))
        && bounded_text(item.get("text"), 160)
        && matches!(item.get("completed"), Some(Value::Bool(_)))
        && matches!(item.get("position"), Some(Value::Number(n)) if n.as_u64().is_some_and(|p| p <= 200))
}

fn notebook_list_shape(value: &Value) -> bool {
    let Some(list) = object_within(
        value,
        &["id", "name", "createdAt", "updatedAt", "items"],
        &["description", "type", "updatedBy"],
    ) else {
        return false;
    };
    if !actor_or_absent(list.get("updatedBy")) {
        return false;
    }
    matches!(list.get("id"), Some(Value::String(id)) if is_id(id))
        && bounded_text(list.get("name"), 80)
        && matches!(list.get("items"), Some(Value::Array(items))
            if items.len() <= 200 && items.iter().all(notebook_item_shape))
}

/// One household's lists (`lib/notebook-contract.js`). List type is metadata;
/// nothing here depends on what a list is for.
fn notebook_shape(value: &Value) -> bool {
    let Some(object) = object_with_keys(value, &["kind", "notebook"]) else {
        return false;
    };
    if object.get("kind") != Some(&Value::String("household-notebook".into())) {
        return false;
    }
    let Some(book) = object
        .get("notebook")
        .and_then(|book| object_with_keys(book, &["version", "householdId", "commitId", "lists"]))
    else {
        return false;
    };
    let Some(Value::Array(lists)) = book.get("lists") else {
        return false;
    };
    let mut ids = std::collections::HashSet::new();
    book.get("version") == Some(&Value::from(1))
        && matches!(book.get("householdId"), Some(Value::String(id)) if is_id(id))
        && matches!(book.get("commitId"), Some(Value::String(id)) if is_uuid(id))
        && lists.len() <= 50
        && lists.iter().all(notebook_list_shape)
        && lists
            .iter()
            .all(|list| ids.insert(list.get("id").and_then(Value::as_str)))
}

/// Accept any stored record kind for `create` and `edit`.
pub fn record_data(value: &Value) -> Outcome<Kind> {
    if profile_shape(value) {
        Ok(Kind::Profile)
    } else if grocery_shape(value) {
        Ok(Kind::Grocery)
    } else if notebook_shape(value) {
        Ok(Kind::Notebook)
    } else {
        Err(Failure::Invalid("record-data"))
    }
}

/// Accept only the bounded profile record for `editProfile`. Grocery or
/// notebook data on this path is invalid input, not a conflict.
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
    } else if value.get("kind") == Some(&Value::String("household-notebook".into())) {
        Kind::Notebook
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

    fn notebook() -> Value {
        json!({ "kind": "household-notebook", "notebook": { "version": 1, "householdId": "home-example",
            "commitId": "3d735c0e-3176-4502-8717-8e62f59d3a91", "lists": [
                { "id": "list-1", "name": "Movies to watch", "type": "entertainment",
                    "updatedBy": { "kind": "human", "id": "alex-example" },
                    "createdAt": "2026-11-10T20:00:00.000Z", "updatedAt": "2026-11-10T20:00:00.000Z",
                    "items": [ { "id": "item-1", "text": "Tortillas", "quantity": 2, "unit": "packs", "notes": "corn", "category": "Forms",
                        "updatedBy": { "kind": "assistant", "id": "luna" },
                        "completed": false, "position": 0,
                        "createdAt": "2026-11-10T20:00:00.000Z", "updatedAt": "2026-11-10T20:00:00.000Z" } ] } ] } })
    }

    #[test]
    fn notebook_records_are_bounded_and_never_profile_data() {
        assert_eq!(record_data(&notebook()), Ok(Kind::Notebook));
        assert_eq!(kind_of(&notebook()), Kind::Notebook);
        assert_eq!(
            profile_data(&notebook()),
            Err(Failure::Invalid("profile-data"))
        );
        let empty = json!({ "kind": "household-notebook", "notebook": { "version": 1,
            "householdId": "home-example", "commitId": "3d735c0e-3176-4502-8717-8e62f59d3a91", "lists": [] } });
        assert_eq!(record_data(&empty), Ok(Kind::Notebook));
        let change = |path: &[&str], value: Value| {
            let mut book = notebook();
            let mut cursor = &mut book;
            for key in &path[..path.len() - 1] {
                cursor = match key.parse::<usize>() {
                    Ok(index) => &mut cursor[index],
                    Err(_) => &mut cursor[*key],
                };
            }
            cursor[path[path.len() - 1]] = value;
            book
        };
        let list = notebook()["notebook"]["lists"][0].clone();
        let item = list["items"][0].clone();
        for bad in [
            change(&["extra"], json!(true)),
            change(&["notebook", "version"], json!(2)),
            change(&["notebook", "householdId"], json!("home example")),
            change(&["notebook", "commitId"], json!("not-a-commit")),
            change(&["notebook", "extra"], json!(true)),
            change(&["notebook", "lists"], json!(vec![list.clone(); 2])),
            change(&["notebook", "lists"], json!(vec![json!({}); 51])),
            change(&["notebook", "lists", "0", "name"], json!("   ")),
            change(&["notebook", "lists", "0", "name"], json!("n".repeat(81))),
            change(&["notebook", "lists", "0", "extra"], json!(true)),
            change(
                &["notebook", "lists", "0", "updatedBy"],
                json!("alex-example"),
            ),
            change(
                &["notebook", "lists", "0", "items", "0", "updatedBy", "kind"],
                json!("device"),
            ),
            change(
                &["notebook", "lists", "0", "items"],
                json!(vec![item.clone(); 201]),
            ),
            change(
                &["notebook", "lists", "0", "items", "0", "text"],
                json!("t".repeat(161)),
            ),
            change(
                &["notebook", "lists", "0", "items", "0", "completed"],
                json!("no"),
            ),
            change(
                &["notebook", "lists", "0", "items", "0", "position"],
                json!(-1),
            ),
            change(
                &["notebook", "lists", "0", "items", "0", "extra"],
                json!(true),
            ),
        ] {
            assert_eq!(
                record_data(&bad),
                Err(Failure::Invalid("record-data")),
                "{bad}"
            );
        }
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
