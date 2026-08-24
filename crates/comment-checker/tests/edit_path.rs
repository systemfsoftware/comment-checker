//! The Edit-path gate: every corpus case driven through `check` as an `Edit`
//! payload. `f1.rs` exercises the `Write` path only, so before this gate the
//! `Edit`/`MultiEdit` path carried no corpus coverage — which is how a blanket
//! fragment acquittal shipped while every other gate stayed green.

mod common;

use claude_code_comment_checker::{Outcome, check};
use common::{Case, Label, load_corpus, synthesize_source, synthesized_path};

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

/// The realistic edit: the file held the case's code, and the agent's edit adds
/// the comment above, below, or beside it.
fn edit_payload(case: &Case) -> String {
    let file_path = synthesized_path(case);
    let old = escape(&format!("{}\n", case.code));
    let new = escape(&synthesize_source(case));
    format!(
        r#"{{"tool_name":"Edit","tool_input":{{"file_path":"{file_path}","old_string":"{old}","new_string":"{new}"}}}}"#
    )
}

fn blocks(case: &Case) -> bool {
    matches!(check(&edit_payload(case), ""), Outcome::Block { .. })
}

#[test]
fn edit_path_never_blocks_a_justified_comment() {
    let offenders: Vec<_> = load_corpus()
        .into_iter()
        .filter(|case| case.label == Label::Justified && blocks(case))
        .map(|case| format!("[{}/{}] {}", case.kind, case.language, case.text))
        .collect();
    assert!(
        offenders.is_empty(),
        "{} justified corpus case(s) blocked on the Edit path:\n  {}",
        offenders.len(),
        offenders.join("\n  ")
    );
}

#[test]
fn edit_path_catches_every_unnecessary_corpus_case() {
    let missed: Vec<_> = load_corpus()
        .into_iter()
        .filter(|case| case.label == Label::Unnecessary && !blocks(case))
        .map(|case| format!("[{}/{}] {}", case.kind, case.language, case.text))
        .collect();
    assert!(
        missed.is_empty(),
        "{} unnecessary corpus case(s) spared on the Edit path:\n  {}",
        missed.len(),
        missed.join("\n  ")
    );
}
