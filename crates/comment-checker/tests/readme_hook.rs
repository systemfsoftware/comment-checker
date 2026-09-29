#![cfg(unix)]

use std::fs::{self, File};
use std::io::{self, Seek, Write};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

const README: &str = include_str!("../../../npm/packages/comment-checker/README.md");
const GUIDANCE: &str = "comment-checker did not run — nothing checked this write.";
const CONTENT_LARGER_THAN_ANY_PIPE_BUFFER: usize = 1 << 20;

fn readme_hook_command() -> String {
    let commands: Vec<String> = README
        .split("```json\n")
        .skip(1)
        .filter_map(|block| block.split("```").next())
        .filter_map(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .flat_map(|cfg| {
            cfg["hooks"]["PostToolUse"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
                .filter(|hook| hook["type"] == "command")
                .filter_map(|hook| hook["command"].as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect();
    assert_eq!(
        commands.len(),
        1,
        "the README must document exactly one PostToolUse command hook, found {commands:?}"
    );
    commands.into_iter().next().expect("one command")
}

fn payload() -> Vec<u8> {
    serde_json::json!({
        "tool_name": "Write",
        "tool_input": {
            "file_path": "src/big.ts",
            "content": "x".repeat(CONTENT_LARGER_THAN_ANY_PIPE_BUFFER),
        }
    })
    .to_string()
    .into_bytes()
}

fn host_executable(name: &str) -> PathBuf {
    std::env::split_paths(&std::env::var_os("PATH").expect("PATH is set"))
        .map(|dir| dir.join(name))
        .find(|path| path.is_file())
        .unwrap_or_else(|| panic!("`{name}` must be on the test host's PATH"))
}

struct Sandbox {
    root: PathBuf,
    sh: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "comment-checker-readme-hook-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("bin")).expect("create sandbox bin");
        fs::create_dir_all(root.join("hidden")).expect("create sandbox hidden bin");
        symlink(host_executable("cat"), root.join("bin/cat")).expect("link cat");
        Self {
            root,
            sh: host_executable("sh"),
        }
    }

    fn capture(&self) -> PathBuf {
        self.root.join("captured-stdin")
    }

    fn install(&self, dir: &str, name: &str, body: &str) {
        let path = self.root.join(dir).join(name);
        fs::write(&path, format!("#!{}\n{body}\n", self.sh.display())).expect("write stub");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod stub");
    }

    fn install_checker_recording_stdin(&self, dir: &str, code: i32) {
        let body = format!("cat > '{}'\nexit {code}", self.capture().display());
        self.install(dir, "comment-checker", &body);
    }

    fn install_direnv_loading_hidden_dir(&self) {
        let body = format!(
            "[ \"$1\" = exec ] || exit 99\nshift 2\nPATH='{}':\"$PATH\" exec \"$@\"",
            self.root.join("hidden").display()
        );
        self.install("bin", "direnv", &body);
    }

    fn install_direnv_failing_before_stdin(&self) {
        self.install(
            "bin",
            "direnv",
            "echo 'direnv: error .envrc is blocked' >&2\nexit 1",
        );
    }

    fn hook(&self, stdin: Stdio) -> Command {
        let mut cmd = Command::new(&self.sh);
        cmd.arg("-c")
            .arg(readme_hook_command())
            .current_dir(&self.root)
            .env_clear()
            .env("PATH", self.root.join("bin"))
            .stdin(stdin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }

    fn pipe_from_writer_thread(&self, payload: &[u8]) -> (io::Result<()>, Output) {
        let mut child = self.hook(Stdio::piped()).spawn().expect("spawn sh");
        let mut stdin = child.stdin.take().expect("stdin");
        let payload = payload.to_vec();
        let writer = thread::spawn(move || stdin.write_all(&payload));
        let output = child.wait_with_output().expect("wait for hook");
        (writer.join().expect("writer thread"), output)
    }

    fn bytes_read_through_shared_file_offset(&self, payload: &[u8]) -> (u64, Output) {
        let path = self.root.join("payload.json");
        fs::write(&path, payload).expect("write payload file");
        let mut file = File::open(&path).expect("open payload file");
        let stdin = Stdio::from(file.try_clone().expect("share payload fd"));
        let output = self.hook(stdin).output().expect("run hook");
        (file.stream_position().expect("read offset"), output)
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn assert_not_run_report(output: &Output, case: &str) {
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(
        output.status.code(),
        Some(1),
        "{case}: the hook must exit 1 when nothing was checked; stderr: {stderr}"
    );
    assert!(
        stderr.lines().any(|line| line == GUIDANCE),
        "{case}: stderr must carry the did-not-run guidance line; got: {stderr}"
    );
}

fn assert_drains_and_reports(sandbox: &Sandbox, case: &str) {
    let payload = payload();

    let (written, output) = sandbox.pipe_from_writer_thread(&payload);
    assert!(
        written.is_ok(),
        "{case}: the hook exited without draining its stdin, so the writer hit {written:?}"
    );
    assert_not_run_report(&output, case);

    let (consumed, output) = sandbox.bytes_read_through_shared_file_offset(&payload);
    assert_eq!(
        consumed,
        payload.len() as u64,
        "{case}: the hook must consume every payload byte"
    );
    assert_not_run_report(&output, case);
}

fn assert_runs_checker(sandbox: &Sandbox, dir: &str, code: i32) {
    let payload = payload();
    sandbox.install_checker_recording_stdin(dir, code);
    let (written, output) = sandbox.pipe_from_writer_thread(&payload);
    assert!(written.is_ok(), "writer hit {written:?}");
    assert_eq!(
        output.status.code(),
        Some(code),
        "the checker's exit code must pass through; stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        fs::read(sandbox.capture()).expect("checker captured stdin") == payload,
        "the checker must receive the payload unchanged"
    );
}

#[test]
fn readme_hook_drains_payload_and_reports_when_checker_is_on_neither_path_nor_direnv() {
    assert_drains_and_reports(&Sandbox::new(), "no comment-checker, no direnv");

    let sandbox = Sandbox::new();
    sandbox.install_direnv_failing_before_stdin();
    assert_drains_and_reports(&sandbox, "direnv cannot resolve comment-checker");
}

#[test]
fn readme_hook_runs_checker_from_path_with_payload_unchanged_and_exit_passed_through() {
    for code in [0, 2] {
        assert_runs_checker(&Sandbox::new(), "bin", code);
    }
}

#[test]
fn readme_hook_runs_checker_through_direnv_with_payload_unchanged_and_exit_passed_through() {
    for code in [0, 2] {
        let sandbox = Sandbox::new();
        sandbox.install_direnv_loading_hidden_dir();
        assert_runs_checker(&sandbox, "hidden", code);
    }
}
