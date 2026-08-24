//! The Edit-path gate: every corpus case driven through `check` as an `Edit`
//! payload. `f1.rs` exercises the `Write` path only, so before this gate the
//! `Edit`/`MultiEdit` path carried no corpus coverage — which is how a blanket
//! fragment acquittal shipped while every other gate stayed green.

mod common;

use claude_code_comment_checker::{Outcome, check};
use common::{Case, Label, edit_payload, load_corpus, synthesize_source, synthesized_path};

fn blocks(case: &Case) -> bool {
    let payload = edit_payload(
        &synthesized_path(case),
        &format!("{}\n", case.code),
        &synthesize_source(case),
    );
    matches!(check(&payload, ""), Outcome::Block { .. })
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
