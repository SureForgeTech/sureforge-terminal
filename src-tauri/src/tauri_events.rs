// The Tauri event names are the contract between the native shell and the
// renderer: this crate emits them and the renderer listens for them. Both
// sides are checked against src-tauri/tauri-events.txt, so a name that
// changes on one side only fails that side's test.
//
// The check has two halves, because the names alone are not enough: the names
// the crate declares must be the names in the list, and the names the crate
// actually emits must be those four, once each — a crate that emitted the
// menu event where the close event belongs would still declare the right
// names.
//
// The emit sites are found by reading the crate root's source rather than by
// parsing Rust, which the validation path has no parser for. The pattern is
// narrow on purpose: a call of the form `.emit(NAME,` on a line that is not
// a comment. A comment that quotes such a call would fail the count, which
// is the safe direction: it asks the author to say so rather than letting a
// wrong emit site through.
#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    const SHARED_EVENT_NAMES: &str = include_str!("../tauri-events.txt");

    fn shared_event_names() -> BTreeSet<String> {
        let mut names = BTreeSet::new();
        for line in SHARED_EVENT_NAMES.lines() {
            let name = line.trim();
            if name.is_empty() || name.starts_with('#') {
                continue;
            }
            names.insert(name.to_string());
        }
        names
    }

    fn declared_event_names() -> BTreeSet<String> {
        let mut names = BTreeSet::new();
        names.insert(crate::SESSION_STREAM_EVENT_NAME.to_string());
        names.insert(crate::UPDATE_INSTALL_PROGRESS_EVENT_NAME.to_string());
        names.insert(crate::MENU_EVENT_NAME.to_string());
        names.insert(crate::WINDOW_CLOSE_REQUESTED_EVENT.to_string());
        names
    }

    #[test]
    fn declared_event_names_match_the_shared_list() {
        assert_eq!(declared_event_names(), shared_event_names());
    }

    #[test]
    fn every_event_is_emitted_from_exactly_one_place() {
        let source = include_str!("main.rs");
        let mut emit_sites = 0;
        for line in source.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("//") {
                continue;
            }
            if line.contains(".emit(") {
                emit_sites += 1;
            }
        }
        assert_eq!(
            emit_sites,
            declared_event_names().len(),
            "every emit site must name one of the shared events"
        );
        for name in declared_event_names() {
            let sites = source
                .lines()
                .filter(|line| line.contains(".emit(") && line.contains(&name))
                .count();
            assert_eq!(sites, 1, "the event {} must be emitted from exactly one place", name);
        }
    }
}
