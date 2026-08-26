use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

struct Run {
    status: std::process::ExitStatus,
    stdout: String,
    stderr: String,
}

struct TempPy {
    path: PathBuf,
}

impl TempPy {
    fn write(contents: &str) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "comment-checker-strip-{}-{}.py",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&path, contents).expect("write fixture");
        Self { path }
    }

    fn read(&self) -> String {
        fs::read_to_string(&self.path).expect("read fixture")
    }
}

impl Drop for TempPy {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn run_binary(payload: &str, args: &[&str]) -> Run {
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

fn write_payload(path: &Path, content: &str) -> String {
    serde_json::json!({
        "tool_name": "Write",
        "tool_input": {
            "file_path": path.to_str().expect("utf-8 path"),
            "content": content,
        }
    })
    .to_string()
}

fn edit_payload(path: &Path, old: &str, new: &str) -> String {
    serde_json::json!({
        "tool_name": "Edit",
        "tool_input": {
            "file_path": path.to_str().expect("utf-8 path"),
            "old_string": old,
            "new_string": new,
        }
    })
    .to_string()
}

const SLOP: &str = "def load(path):\n    # Parse the config file\n    return path\n";
const CLEAN: &str = "def load(path):\n    return path\n";
const TRAILING: &str = "x = 1  # TODO: fix this later\n";

#[test]
fn strip_deletes_a_whole_line_comment_and_keeps_the_code() {
    let file = TempPy::write(SLOP);
    let run = run_binary(&write_payload(&file.path, SLOP), &["--strip"]);
    assert_eq!(run.status.code(), Some(2));
    assert_eq!(file.read(), CLEAN);
    assert!(run.stderr.contains("Deleted 1 comment(s)"));
    assert!(run.stderr.contains("Do this: rename the identifiers"));
    assert!(!run.stderr.contains("Action: delete the flagged comments"));
    assert!(run.stdout.is_empty());
}

#[test]
fn without_strip_the_file_is_unchanged() {
    let file = TempPy::write(SLOP);
    let run = run_binary(&write_payload(&file.path, SLOP), &[]);
    assert_eq!(run.status.code(), Some(2));
    assert_eq!(file.read(), SLOP);
    assert!(run.stderr.contains("Action: delete the flagged comments"));
}

#[test]
fn strip_leaves_a_trailing_comment_and_reports_it() {
    let file = TempPy::write(TRAILING);
    let run = run_binary(&write_payload(&file.path, TRAILING), &["--strip"]);
    assert_eq!(run.status.code(), Some(2));
    assert_eq!(file.read(), TRAILING);
    assert!(run.stderr.contains("need a rewrite rather than a cut"));
    assert!(run.stderr.contains("Do this: change those lines"));
    assert!(!run.stderr.contains("Deleted"));
}

#[test]
fn strip_on_a_clean_file_is_silent() {
    let file = TempPy::write(CLEAN);
    let run = run_binary(&write_payload(&file.path, CLEAN), &["--strip"]);
    assert!(run.status.success());
    assert_eq!(file.read(), CLEAN);
    assert!(run.stderr.is_empty());
}

#[test]
fn strip_is_idempotent() {
    let file = TempPy::write(SLOP);
    let first = run_binary(&write_payload(&file.path, SLOP), &["--strip"]);
    assert_eq!(first.status.code(), Some(2));
    let after = file.read();
    let second = run_binary(&write_payload(&file.path, &after), &["--strip"]);
    assert!(second.status.success());
    assert_eq!(file.read(), after);
}

#[test]
fn strip_judges_the_file_on_disk_for_an_edit_payload() {
    let file = TempPy::write(SLOP);
    let run = run_binary(
        &edit_payload(&file.path, "return path\n", SLOP),
        &["--strip"],
    );
    assert_eq!(run.status.code(), Some(2));
    assert_eq!(file.read(), CLEAN);
}

#[test]
fn strip_without_a_file_stays_report_only() {
    let payload = r#"{"tool_name":"Write","tool_input":{"file_path":"src/load_config.py","content":"def load_config(path):\n    # TODO: fix this later\n    return path\n"}}"#;
    let run = run_binary(payload, &["--strip"]);
    assert_eq!(run.status.code(), Some(2));
    assert!(run.stderr.contains("Action: delete the flagged comments"));
    assert!(!run.stderr.contains("Deleted"));
}
