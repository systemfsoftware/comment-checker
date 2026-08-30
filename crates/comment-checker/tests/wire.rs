use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn plugin_hook_registers_post_tool_use_with_launcher() {
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
    assert!(
        !hooks.contains("--strip"),
        "plugin hook must run check mode, not strip"
    );
    assert!(
        hooks.contains("awk"),
        "plugin hook must scrub the whole LD_*/DYLD_* env class, not a finite list"
    );
}

#[test]
fn project_hook_registers_post_tool_use_without_strip_or_swallow() {
    let settings = fs::read_to_string(repo_root().join(".claude/settings.json")).unwrap();
    assert!(
        settings.contains("\"PostToolUse\""),
        "project hook must run on PostToolUse"
    );
    assert!(
        !settings.contains("--strip"),
        "project hook must run check mode, not strip"
    );
    assert!(
        !settings.contains("|| exit 0"),
        "project hook must never swallow failures silently"
    );
    assert!(
        !settings.contains("pnpm add"),
        "hook must not inject an install instruction into the model context"
    );
}

#[test]
fn launcher_runs_checker_in_check_mode() {
    let run_ts = fs::read_to_string(repo_root().join("hooks/run.ts")).unwrap();
    assert!(
        !run_ts.contains("--strip"),
        "launcher must invoke the checker in check mode, not strip"
    );
    assert!(
        run_ts.contains("} catch {") && !run_ts.contains("throw error"),
        "launcher must absorb every spawn failure instead of rethrowing"
    );
    assert!(
        !run_ts.contains("pnpm add"),
        "launcher must not inject an install instruction into the model context"
    );
}
