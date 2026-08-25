//! Black-box exit-code and output-stream contract assert (issue #6).
//!
//! The release workflow's smoke step hard-codes `rc -eq 2` for flagged
//! payloads; that contract previously lived only in YAML, duplicated and
//! untested. These tests pin the contract in the crate so a classifier
//! exit-code change breaks CI here, not at the first tag run.

use std::io::Write;
use std::process::{Command, Stdio};

/// The hook's blocked-verdict exit code — the constant the release smoke
/// step asserts (`test "$rc" -eq 2`).
const BLOCKED_EXIT_CODE: u8 = 2;

const CLEAN_PAYLOAD: &str = r##"{"tool_name":"Write","tool_input":{"file_path":"src/client.py","content":"# SPDX-License-Identifier: Apache-2.0\ndef load(path):\n    return open(path).read()\n"}}"##;

const FLAGGED_PAYLOAD: &str = r#"{"tool_name":"Write","tool_input":{"file_path":"src/load_config.py","content":"def load_config(path):\n    # TODO: fix this later\n    return json.load(open(path))\n"}}"#;

const EDIT_FLAGGED_PAYLOAD: &str = r#"{"tool_name":"Edit","tool_input":{"file_path":"foo.py","old_string":"x = 1\n","new_string":"x = 1  # TODO: handle this\n"}}"#;

const MULTI_EDIT_FLAGGED_PAYLOAD: &str = r#"{"tool_name":"MultiEdit","tool_input":{"file_path":"foo.py","edits":[{"old_string":"x = 1\n","new_string":"x = 1\n# TODO: handle\n"}]}}"#;

const REPORT_HEADER: &str = "An automated reviewer flagged";
const REPORT_ACTION: &str = "Action: delete the flagged comments.";
const REPORT_REASON: &str = "a TODO with no tracked reference";
const PASS_NOTE: &str = "[check-comments] Skipping";

struct Run {
    status: std::process::ExitStatus,
    stdout: String,
    stderr: String,
}

fn run_binary(payload: &str) -> Run {
    run_binary_with_args(payload, &[])
}

fn run_binary_with_args(payload: &str, args: &[&str]) -> Run {
    let mut child = Command::new(env!("CARGO_BIN_EXE_comment-checker"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn comment-checker binary");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(payload.as_bytes())
        .expect("write payload");
    let out = child.wait_with_output().expect("wait for binary");
    Run {
        status: out.status,
        stdout: String::from_utf8(out.stdout).expect("stdout is utf-8"),
        stderr: String::from_utf8(out.stderr).expect("stderr is utf-8"),
    }
}

fn assert_report_on_stderr_only(run: &Run, label: &str) {
    for anchor in [REPORT_HEADER, REPORT_ACTION, REPORT_REASON] {
        assert!(
            run.stderr.contains(anchor),
            "{label}: exit 2 forwards stderr to the model and drops stdout, so the \
             whole report must be on stderr; missing {anchor:?}, stderr was {:?}",
            run.stderr
        );
    }
    assert!(
        run.stdout.is_empty(),
        "{label}: a blocked verdict must leave stdout empty; stdout was {:?}",
        run.stdout
    );
}

#[test]
fn clean_payload_exits_zero() {
    assert!(run_binary(CLEAN_PAYLOAD).status.success());
}

#[test]
fn clean_payload_notes_on_stdout_only() {
    let run = run_binary(CLEAN_PAYLOAD);
    assert!(
        run.stdout.contains(PASS_NOTE),
        "a pass note belongs on stdout, which a host keeps to its debug log; stdout was {:?}",
        run.stdout
    );
    assert!(
        run.stderr.is_empty(),
        "a passing verdict must leave stderr empty so nothing reaches the model; stderr was {:?}",
        run.stderr
    );
}

#[test]
fn flagged_payload_exits_with_the_blocked_contract() {
    let run = run_binary(FLAGGED_PAYLOAD);
    assert_eq!(
        run.status.code(),
        Some(i32::from(BLOCKED_EXIT_CODE)),
        "flagged payload must exit {BLOCKED_EXIT_CODE} — this constant is \
         duplicated in .github/workflows/release.yml smoke step; changing it \
         requires updating both"
    );
}

#[test]
fn flagged_write_reports_on_stderr_only() {
    assert_report_on_stderr_only(&run_binary(FLAGGED_PAYLOAD), "Write");
}

#[test]
fn flagged_edit_reports_on_stderr_only() {
    assert_report_on_stderr_only(&run_binary(EDIT_FLAGGED_PAYLOAD), "Edit");
}

#[test]
fn flagged_multi_edit_reports_on_stderr_only() {
    assert_report_on_stderr_only(&run_binary(MULTI_EDIT_FLAGGED_PAYLOAD), "MultiEdit");
}

#[test]
fn custom_prompt_report_lands_on_stderr() {
    let run = run_binary_with_args(FLAGGED_PAYLOAD, &["--prompt", "Review:\n\n{{comments}}"]);
    assert!(
        run.stderr.contains("Review:") && run.stderr.contains(REPORT_HEADER),
        "a --prompt report must reach the model on stderr too; stderr was {:?}",
        run.stderr
    );
    assert!(
        run.stdout.is_empty(),
        "a blocked verdict must leave stdout empty; stdout was {:?}",
        run.stdout
    );
}
