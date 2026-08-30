use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn plugin_hook_registers_post_tool_use_with_strip_launcher() {
    let hooks = fs::read_to_string(repo_root().join("hooks/hooks.json")).unwrap();
    assert!(
        hooks.contains("\"PostToolUse\""),
        "plugin hook must run on PostToolUse"
    );
    assert!(
        hooks.contains("Write|Edit|MultiEdit"),
        "plugin hook matcher must cover Write|Edit|MultiEdit"
    );
    assert!(
        hooks.contains("run.ts"),
        "plugin hook must invoke the launcher"
    );
}

#[test]
fn project_hook_registers_post_tool_use_without_swallow() {
    let settings = fs::read_to_string(repo_root().join(".claude/settings.json")).unwrap();
    assert!(
        settings.contains("\"PostToolUse\""),
        "project hook must run on PostToolUse"
    );
    assert!(
        settings.contains("--strip"),
        "project hook must auto-strip flagged comments"
    );
    assert!(
        !settings.contains("|| exit 0"),
        "project hook must never swallow failures silently"
    );
}

#[test]
fn launcher_runs_checker_in_strip_mode() {
    let run_ts = fs::read_to_string(repo_root().join("hooks/run.ts")).unwrap();
    assert!(
        run_ts.contains("'--strip'"),
        "launcher must invoke the checker with --strip"
    );
    assert!(
        run_ts.contains("NotCapable"),
        "launcher must treat spawn denials as binary-unavailable"
    );
}
