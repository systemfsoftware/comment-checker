//! Black-box exit-code contract assert (issue #6).
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

fn run_binary(payload: &str) -> std::process::ExitStatus {
    let mut child = Command::new(env!("CARGO_BIN_EXE_comment-checker"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn comment-checker binary");
    // Test harness vs gate split: the binary reads stdin until EOF; the OS
    // default write buffer is larger than any payload here.
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(payload.as_bytes())
        .expect("write payload");
    child.wait().expect("wait for binary")
}

#[test]
fn clean_payload_exits_zero() {
    assert!(run_binary(CLEAN_PAYLOAD).success());
}

#[test]
fn flagged_payload_exits_with_the_blocked_contract() {
    let status = run_binary(FLAGGED_PAYLOAD);
    assert_eq!(
        status.code(),
        Some(i32::from(BLOCKED_EXIT_CODE)),
        "flagged payload must exit {BLOCKED_EXIT_CODE} — this constant is \
         duplicated in .github/workflows/release.yml smoke step; changing it \
         requires updating both"
    );
}
