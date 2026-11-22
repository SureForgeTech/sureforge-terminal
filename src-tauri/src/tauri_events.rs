// The Tauri event names are the contract between the native shell and the
// renderer: this crate emits them and the renderer listens for them. Both
// sides are checked against src-tauri/tauri-events.txt, so a name that
// changes on one side only fails that side's test.
//
// This checks the names the crate declares. The crate's four emit sites are
// not enumerated: the validation path has no Rust parser, and reading source
// text for call sites is a guess — a check that guesses wrong and passes is
// worse than no check at all. An emitter that sends the wrong event is a
// logic mistake, and it is caught in review.
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
}
