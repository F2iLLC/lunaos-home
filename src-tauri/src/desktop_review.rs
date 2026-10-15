//! Synthetic-data development probe, excluded from Android and release builds.
use tauri::Url;

const INVALID_ARGUMENTS: &str =
    "Use --fictional-review-url http://127.0.0.1:PORT/#vault, or launch without arguments.";

pub fn review_url(args: impl IntoIterator<Item = String>) -> Result<Option<Url>, &'static str> {
    let args: Vec<String> = args.into_iter().collect();
    if args.is_empty() {
        return Ok(None);
    }
    if args.len() != 2 || args[0] != "--fictional-review-url" {
        return Err(INVALID_ARGUMENTS);
    }
    let url = Url::parse(&args[1]).map_err(|_| INVALID_ARGUMENTS)?;
    // Require the literal, canonical address; do not accept DNS names, alternate
    // IP spellings, credentials, normalized paths or parser-trimmed whitespace.
    if !allowed_navigation(&url, &url) || url.fragment() != Some("vault") || url.as_str() != args[1]
    {
        return Err(INVALID_ARGUMENTS);
    }
    Ok(Some(url))
}

pub fn allowed_navigation(selected: &Url, candidate: &Url) -> bool {
    candidate.scheme() == "http"
        && candidate.host_str() == Some("127.0.0.1")
        && candidate.port().is_some_and(|port| port != 0)
        && candidate.origin() == selected.origin()
        && candidate.username().is_empty()
        && candidate.password().is_none()
        && candidate.path() == "/"
        && candidate.query().is_none()
        && matches!(
            candidate.fragment(),
            None | Some("vault" | "checklist" | "welcome")
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: &str) -> Result<Option<Url>, &'static str> {
        review_url(["--fictional-review-url".into(), value.into()])
    }

    #[test]
    fn explicit_probe_and_default_launch() {
        assert_eq!(review_url(Vec::new()), Ok(None));
        assert!(parse("http://127.0.0.1:4183/#vault").unwrap().is_some());
        assert!(review_url(["--unknown".into()]).is_err());
        assert!(review_url(["--fictional-review-url".into()]).is_err());
        assert!(review_url([
            "--fictional-review-url".into(),
            "http://127.0.0.1:4183/#vault".into(),
            "extra".into()
        ])
        .is_err());
    }

    #[test]
    fn rejects_nonlocal_ambiguous_and_unexpected_input() {
        for value in [
            "https://127.0.0.1:4183/#vault",
            "http://localhost:4183/#vault",
            "http://192.168.1.1:4183/#vault",
            "http://127.1:4183/#vault",
            "http://2130706433:4183/#vault",
            "http://[::1]:4183/#vault",
            "http://127.0.0.1/#vault",
            "http://127.0.0.1:0/#vault",
            "http://user:secret@127.0.0.1:4183/#vault",
            "http://127.0.0.1:4183/api/draft#vault",
            "http://127.0.0.1:4183/?token=secret#vault",
            "http://127.0.0.1:4183/",
            "http://127.0.0.1:4183/a/../#vault",
            " http://127.0.0.1:4183/#vault",
            "file:///example",
            "not a URL",
        ] {
            assert!(parse(value).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn navigation_stays_in_selected_preview() {
        let selected = parse("http://127.0.0.1:4183/#vault").unwrap().unwrap();
        for fragment in ["", "#welcome", "#vault", "#checklist"] {
            let candidate = Url::parse(&format!("http://127.0.0.1:4183/{fragment}")).unwrap();
            assert!(allowed_navigation(&selected, &candidate));
        }
        for value in [
            "http://127.0.0.1:4184/#vault",
            "https://example.com/",
            "http://127.0.0.1:4183/api/draft",
            "http://127.0.0.1:4183/?q=1",
            "http://user@127.0.0.1:4183/#vault",
            "http://127.0.0.1:4183/#unexpected",
            "about:blank",
            "data:text/html,example",
            "file:///example",
        ] {
            assert!(
                !allowed_navigation(&selected, &Url::parse(value).unwrap()),
                "allowed {value}"
            );
        }
    }
}
