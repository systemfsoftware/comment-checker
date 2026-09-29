#![cfg(unix)]

use serde_json::Value;
use std::fs::{self, File};
use std::io::{self, Seek, Write};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

const README: &str = include_str!("../../../npm/packages/comment-checker/README.md");
const REPO_SETTINGS: &str = include_str!("../../../.claude/settings.json");
const PLUGIN_HOOKS: &str = include_str!("../../../hooks/hooks.json");
const PLUGIN_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
const NOTHING_CHECKED: &str = "nothing checked this write.";
const NOT_RUN: &str = "comment-checker did not run — nothing checked this write.";
const CONTENT_LARGER_THAN_ANY_PIPE_BUFFER: usize = 1 << 20;

fn command_hooks(post_tool_use: &Value) -> Vec<String> {
    post_tool_use
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
        .filter(|hook| hook["type"] == "command")
        .filter_map(|hook| hook["command"].as_str().map(str::to_owned))
        .collect()
}

fn exactly_one(commands: &[String], source: &str) -> String {
    let [command] = commands else {
        panic!("{source} must wire exactly one PostToolUse command hook, found {commands:?}")
    };
    command.clone()
}

fn parse(json: &str, source: &str) -> Value {
    serde_json::from_str(json).unwrap_or_else(|err| panic!("{source} is not JSON: {err}"))
}

fn readme_hook_command() -> String {
    let commands: Vec<String> = README
        .split("```json\n")
        .skip(1)
        .filter_map(|block| block.split("```").next())
        .filter_map(|json| serde_json::from_str::<Value>(json).ok())
        .flat_map(|cfg| command_hooks(&cfg["hooks"]["PostToolUse"]))
        .collect();
    exactly_one(&commands, "the npm README")
}

fn repo_settings_hook_command() -> String {
    let settings = parse(REPO_SETTINGS, ".claude/settings.json");
    exactly_one(
        &command_hooks(&settings["hooks"]["PostToolUse"]),
        ".claude/settings.json",
    )
}

fn plugin_hook_command() -> String {
    let hooks = parse(PLUGIN_HOOKS, "hooks/hooks.json");
    exactly_one(&command_hooks(&hooks["PostToolUse"]), "hooks/hooks.json")
}

#[derive(Clone, Copy)]
enum Surface {
    Readme,
    Plugin,
}

impl Surface {
    const ALL: [Self; 2] = [Self::Readme, Self::Plugin];

    fn name(self) -> &'static str {
        match self {
            Self::Readme => "README hook",
            Self::Plugin => "plugin hook",
        }
    }

    fn command(self) -> String {
        match self {
            Self::Readme => readme_hook_command(),
            Self::Plugin => plugin_hook_command(),
        }
    }

    fn host_tools(self) -> &'static [&'static str] {
        match self {
            Self::Readme => &["cat", "sh"],
            Self::Plugin => &["cat", "sh", "env", "awk", "deno"],
        }
    }
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
    surface: Surface,
    command: String,
    root: PathBuf,
    sh: PathBuf,
    project_dir_set: bool,
}

impl Sandbox {
    fn new(surface: Surface) -> Self {
        Self::with_host_tools(surface, surface.host_tools())
    }

    fn with_host_tools(surface: Surface, tools: &[&str]) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "comment-checker-hook-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        for dir in ["bin", "hidden", "project", "hook-cwd"] {
            fs::create_dir_all(root.join(dir)).expect("create sandbox dir");
        }
        for tool in tools {
            symlink(host_executable(tool), root.join("bin").join(tool)).expect("link tool");
        }
        Self {
            surface,
            command: surface.command(),
            root,
            sh: host_executable("sh"),
            project_dir_set: true,
        }
    }

    fn without_project_dir(mut self) -> Self {
        self.project_dir_set = false;
        self
    }

    fn case(&self, case: &str) -> String {
        format!("{}, {case}", self.surface.name())
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

    fn install_checker_exiting_without_reading_stdin(&self, dir: &str, code: i32) {
        self.install(dir, "comment-checker", &format!("exit {code}"));
    }

    fn install_direnv_loading_project_env(&self) {
        let body = format!(
            "[ \"$1\" = exec ] && [ \"$2\" = '{}' ] || exit 99\nshift 2\nPATH='{}':\"$PATH\"\ncommand -v \"$1\" >/dev/null 2>&1 || {{ echo \"direnv: error command '$1' not found on PATH\" >&2; exit 1; }}\nexec \"$@\"",
            self.root.join("project").display(),
            self.root.join("hidden").display()
        );
        self.install("bin", "direnv", &body);
    }

    fn install_direnv_blocked_by_envrc(&self) {
        self.install(
            "bin",
            "direnv",
            "echo 'direnv: error .envrc is blocked' >&2\nexit 1",
        );
    }

    fn hook(&self, stdin: Stdio) -> Command {
        let mut cmd = Command::new(&self.sh);
        cmd.arg("-c")
            .arg(&self.command)
            .current_dir(self.root.join("hook-cwd"))
            .env_clear()
            .env("PATH", self.root.join("bin"))
            .env("CLAUDE_PLUGIN_ROOT", PLUGIN_ROOT)
            .stdin(stdin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if self.project_dir_set {
            cmd.env("CLAUDE_PROJECT_DIR", self.root.join("project"));
        }
        for deno_cache in ["HOME", "DENO_DIR"] {
            if let Some(value) = std::env::var_os(deno_cache) {
                cmd.env(deno_cache, value);
            }
        }
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

fn failed_report(code: i32) -> String {
    format!("comment-checker failed (exit {code}) — nothing checked this write.")
}

fn assert_unchecked_report(output: &Output, case: &str, expected: &str) {
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(
        output.status.code(),
        Some(1),
        "{case}: the hook must exit 1 when nothing was checked; stderr: {stderr}"
    );
    let reports: Vec<&str> = stderr
        .lines()
        .filter(|line| line.ends_with(NOTHING_CHECKED))
        .collect();
    assert_eq!(
        reports,
        [expected],
        "{case}: stderr must carry exactly the matching unchecked-write line; got: {stderr}"
    );
}

fn assert_drains_and_reports(sandbox: &Sandbox, case: &str, expected: &str) {
    let case = sandbox.case(case);
    let payload = payload();

    let (written, output) = sandbox.pipe_from_writer_thread(&payload);
    assert!(
        written.is_ok(),
        "{case}: the hook exited without draining its stdin, so the writer hit {written:?}"
    );
    assert_unchecked_report(&output, &case, expected);

    let (consumed, output) = sandbox.bytes_read_through_shared_file_offset(&payload);
    assert_eq!(
        consumed,
        payload.len() as u64,
        "{case}: the hook must consume every payload byte"
    );
    assert_unchecked_report(&output, &case, expected);
}

fn assert_runs_checker(sandbox: &Sandbox, dir: &str, code: i32) {
    let case = sandbox.case(&format!("checker in {dir} exits {code}"));
    let payload = payload();
    sandbox.install_checker_recording_stdin(dir, code);
    let (written, output) = sandbox.pipe_from_writer_thread(&payload);
    assert!(written.is_ok(), "{case}: writer hit {written:?}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(
        output.status.code(),
        Some(code),
        "{case}: the checker's exit code must pass through; stderr: {stderr}"
    );
    assert!(
        !stderr.lines().any(|line| line.ends_with(NOTHING_CHECKED)),
        "{case}: a checker that ran and answered must not be reported as unchecked; stderr: {stderr}"
    );
    assert!(
        fs::read(sandbox.capture()).expect("checker captured stdin") == payload,
        "{case}: the checker must receive the payload unchanged"
    );
}

#[test]
fn repo_settings_hook_runs_the_readme_hook_command() {
    assert_eq!(
        repo_settings_hook_command(),
        readme_hook_command(),
        ".claude/settings.json must wire the exact hook command the npm README documents"
    );
}

#[test]
fn hook_drains_payload_and_reports_when_checker_is_on_neither_path_nor_direnv() {
    for surface in Surface::ALL {
        assert_drains_and_reports(
            &Sandbox::new(surface),
            "no comment-checker, no direnv",
            NOT_RUN,
        );

        let sandbox = Sandbox::new(surface);
        sandbox.install_direnv_loading_project_env();
        assert_drains_and_reports(&sandbox, "direnv env lacks comment-checker", NOT_RUN);
    }
}

#[test]
fn hook_drains_payload_and_reports_failure_when_direnv_envrc_is_blocked() {
    for surface in Surface::ALL {
        let sandbox = Sandbox::new(surface);
        sandbox.install_direnv_blocked_by_envrc();
        assert_drains_and_reports(&sandbox, "direnv .envrc blocked", &failed_report(1));
    }
}

#[test]
fn hook_drains_payload_and_reports_failure_when_path_checker_crashes() {
    for surface in Surface::ALL {
        for code in [101, 127] {
            let sandbox = Sandbox::new(surface);
            sandbox.install_checker_exiting_without_reading_stdin("bin", code);
            assert_drains_and_reports(
                &sandbox,
                &format!("PATH checker exits {code}"),
                &failed_report(code),
            );
        }
    }
}

#[test]
fn hook_drains_payload_and_reports_failure_when_direnv_checker_crashes() {
    for surface in Surface::ALL {
        let sandbox = Sandbox::new(surface);
        sandbox.install_direnv_loading_project_env();
        sandbox.install_checker_exiting_without_reading_stdin("hidden", 101);
        assert_drains_and_reports(&sandbox, "direnv checker exits 101", &failed_report(101));
    }
}

#[test]
fn hook_runs_checker_from_path_with_payload_unchanged_and_exit_passed_through() {
    for surface in Surface::ALL {
        for code in [0, 2] {
            assert_runs_checker(&Sandbox::new(surface), "bin", code);
        }
    }
}

#[test]
fn hook_runs_checker_through_direnv_with_payload_unchanged_and_exit_passed_through() {
    for surface in Surface::ALL {
        for code in [0, 2] {
            let sandbox = Sandbox::new(surface);
            sandbox.install_direnv_loading_project_env();
            assert_runs_checker(&sandbox, "hidden", code);
        }
    }
}

#[test]
fn plugin_hook_drains_payload_and_reports_when_deno_is_missing() {
    let sandbox = Sandbox::with_host_tools(Surface::Plugin, &["cat", "sh", "env", "awk"]);
    sandbox.install_checker_recording_stdin("bin", 0);
    assert_drains_and_reports(&sandbox, "deno not on PATH", NOT_RUN);
}

#[test]
fn plugin_hook_drains_payload_and_reports_when_deno_dies_before_the_launcher_reports() {
    let sandbox = Sandbox::with_host_tools(Surface::Plugin, &["cat", "sh", "env", "awk"]);
    sandbox.install("bin", "deno", "echo 'error: Module not found' >&2\nexit 1");
    sandbox.install_checker_recording_stdin("bin", 0);
    assert_drains_and_reports(&sandbox, "deno exits 1 before run.ts starts", NOT_RUN);
}

#[test]
fn plugin_hook_drains_payload_and_reports_when_project_dir_is_unset() {
    let sandbox = Sandbox::new(Surface::Plugin).without_project_dir();
    sandbox.install_checker_recording_stdin("bin", 0);
    assert_drains_and_reports(&sandbox, "CLAUDE_PROJECT_DIR unset", NOT_RUN);
}
