//! Injected commit-stage faults for the developer harness. The names mirror
//! `scripts/windows-vault-faults.json`, the single source shared with the
//! Windows DPAPI probe; a Node test asserts the two lists match.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Fault {
    #[default]
    None,
    BeforeWrite,
    DuringWrite,
    AfterWrite,
    BeforeReplacement,
    AfterReplacement,
    DiskFull,
    ProcessInterruption,
    TamperedTemporary,
}

pub const NAMES: [(&str, Fault); 8] = [
    ("before-write", Fault::BeforeWrite),
    ("during-write", Fault::DuringWrite),
    ("after-write", Fault::AfterWrite),
    ("before-replacement", Fault::BeforeReplacement),
    ("after-replacement", Fault::AfterReplacement),
    ("disk-full", Fault::DiskFull),
    ("process-interruption", Fault::ProcessInterruption),
    ("tampered-temporary", Fault::TamperedTemporary),
];

impl Fault {
    pub fn parse(name: &str) -> Option<Fault> {
        NAMES
            .iter()
            .find(|(candidate, _)| *candidate == name)
            .map(|(_, fault)| *fault)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_name_parses_and_unknown_names_do_not() {
        for (name, fault) in NAMES {
            assert_eq!(Fault::parse(name), Some(fault));
        }
        assert_eq!(Fault::parse("none"), None);
        assert_eq!(Fault::parse(""), None);
    }
}
