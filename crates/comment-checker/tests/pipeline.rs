//! Composition tests: the flag/spare decision through the whole pipeline
//! (decode → detect → classify → report), at the `check` seam (CONST-T1).

use claude_code_comment_checker::{Outcome, check};

fn write(file_path: &str, content: &str) -> String {
    let content = content
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!(
        r#"{{"tool_name":"Write","tool_input":{{"file_path":"{file_path}","content":"{content}"}}}}"#
    )
}

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
fn edit_fragment_context_is_never_relied_upon() {
    // U2 scenario: an Edit sees only the fragment, so a comment that would
    // restate its adjacent code must NOT be convicted — the text-only floor
    // downgrades, the hook passes, and the user is not blocked on context the
    // fragment cannot vouch for.
    let input = r#"{"tool_name":"Edit","tool_input":{"file_path":"foo.py","old_string":"counter = 0\n","new_string":"counter = 0\n# increment the counter\ncounter += 1\n"}}"#;
    assert!(
        matches!(check(input, ""), Outcome::Pass { .. }),
        "an Edit fragment whose context is unreliable must fall back, not convict"
    );
}

#[test]
fn report_names_the_reason() {
    let input = write("foo.go", "// TODO: refactor later\n");
    let Outcome::Block { report } = check(&input, "") else {
        panic!("expected a block");
    };
    assert!(
        report.contains("no tracked reference"),
        "report was: {report}"
    );
}
