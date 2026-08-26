//! Composition tests: the flag/spare decision through the whole pipeline
//! (decode → detect → classify → report), at the `check` seam (CONST-T1).

use claude_code_comment_checker::{Outcome, check};

mod common;

use common::write_payload as write;

#[test]
fn unnecessary_comment_blocks() {
    let input = write("foo.py", "x = 1  # adds one to one\n");
    assert!(matches!(check(&input, ""), Outcome::Block { .. }));
}

#[test]
fn justified_directive_passes() {
    let input = write("foo.py", "x = 1  # noqa: E501\n");
    assert!(matches!(check(&input, ""), Outcome::Pass { .. }));
}

#[test]
fn license_header_passes() {
    let input = write("foo.py", "# SPDX-License-Identifier: MIT\nx = 1\n");
    assert!(matches!(check(&input, ""), Outcome::Pass { .. }));
}

#[test]
fn no_comments_passes() {
    let input = write("foo.py", "x = 1\n");
    assert!(matches!(check(&input, ""), Outcome::Pass { .. }));
}

#[test]
fn non_code_file_passes() {
    let input = write("README.txt", "some comment here\n");
    assert!(matches!(check(&input, ""), Outcome::Pass { .. }));
}

#[test]
fn invalid_json_passes() {
    assert!(matches!(check("not json", ""), Outcome::Pass { .. }));
}

#[test]
fn edit_keeps_existing_comment_and_passes() {
    let input = r#"{"tool_name":"Edit","tool_input":{"file_path":"foo.py","old_string":"x = 1  # keep me\n","new_string":"x = 2  # keep me\n"}}"#;
    assert!(matches!(check(input, ""), Outcome::Pass { .. }));
}

#[test]
fn edit_new_comment_blocks() {
    let input = r#"{"tool_name":"Edit","tool_input":{"file_path":"foo.py","old_string":"x = 1\n","new_string":"x = 1  # TODO: handle this\n"}}"#;
    assert!(matches!(check(input, ""), Outcome::Block { .. }));
}

#[test]
fn edit_new_restatement_with_code_after_it_blocks() {
    let input = r#"{"tool_name":"Edit","tool_input":{"file_path":"foo.py","old_string":"counter = 0\n","new_string":"counter = 0\n# increment the counter\ncounter += 1\n"}}"#;
    assert!(matches!(check(input, ""), Outcome::Block { .. }));
}

#[test]
fn edit_comment_at_the_fragment_tail_passes() {
    let input = r#"{"tool_name":"Edit","tool_input":{"file_path":"foo.py","old_string":"counter = 0\n","new_string":"counter = 0\n# increment the counter\n"}}"#;
    assert!(matches!(check(input, ""), Outcome::Pass { .. }));
}

#[test]
fn edit_comment_with_no_adjacent_code_passes() {
    let input = r##"{"tool_name":"Edit","tool_input":{"file_path":"foo.py","old_string":"","new_string":"# increment the counter\n"}}"##;
    assert!(matches!(check(input, ""), Outcome::Pass { .. }));
}

#[test]
fn multi_edit_new_restatement_comment_blocks() {
    let input = r#"{"tool_name":"MultiEdit","tool_input":{"file_path":"foo.py","edits":[{"old_string":"x = 1\n","new_string":"x = 1\n# increment the counter\ncounter += 1\n"}]}}"#;
    assert!(matches!(check(input, ""), Outcome::Block { .. }));
}

#[test]
fn multi_edit_new_todo_comment_blocks() {
    let input = r#"{"tool_name":"MultiEdit","tool_input":{"file_path":"foo.py","edits":[{"old_string":"x = 1\n","new_string":"x = 1\n# TODO: handle\n"}]}}"#;
    assert!(matches!(check(input, ""), Outcome::Block { .. }));
}

#[test]
fn report_names_the_reason() {
    let input = write("foo.go", "// TODO: refactor later\n");
    let Outcome::Block { report, .. } = check(&input, "") else {
        panic!("expected a block");
    };
    assert!(
        report.contains("no tracked reference"),
        "report was: {report}"
    );
}

#[test]
fn report_cites_restate_evidence() {
    // The block reason must show the overlap the verdict was built on, so the
    // flag is checkable rather than hand-waved.
    let input = write("foo.rs", "// increment the counter\ncounter += 1;\n");
    let Outcome::Block { report, .. } = check(&input, "") else {
        panic!("expected a block");
    };
    assert!(
        report.contains("shares counter") && report.contains("increment ↔ +="),
        "report was: {report}"
    );
}
