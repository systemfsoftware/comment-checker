---
title: "Deno denies spawning when LD_*/DYLD_* env vars are present, and the hook either crashed or silently passed — scrub the env class and absorb every spawn failure"
date: 2026-08-30
category: runtime-errors
module: hooks/run.ts (Deno launcher), hooks/hooks.json + .claude/settings.json (hook surfaces), crates/comment-checker/tests/wire.rs
problem_type: runtime_error
component: dev-tooling
symptoms:
  - "`Uncaught (in promise) NotCapable: Requires --allow-run permissions to spawn subprocess with LD_FOR_BUILD environment variable` on every Write tool result; writes landed but nothing was checked"
  - "Launcher exit 2 blocks the write while exit 1 does not on some hosts — the silent-pass hole was the settings surface ending `|| exit 0`, and the 8-name env scrub missed unlisted LD_* vars (LD_PRELOAD_64, LD_ASSUME_KERNEL)"
  - "wire.rs passed green after the fix while asserting a token ('NotCapable') that existed only in a comment — reverting the catch-all still left the test green (CHK1)"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [deno, hook, notcapable, env-scrub, allow-run, silent-pass, chk1]
---

# Deno env-sensitive spawn crash and the silent-pass hook

## Problem

The PostToolUse hook could not enforce. The Deno launcher crashed with an uncaught `NotCapable` error whenever a Deno-sensitive env var (`LD_*`, `DYLD_*`) was present, and the settings-surface hook ended in a silent `|| exit 0` — every write passed without being checked.

## Symptoms

- Live crash on this machine (env carries `LD_FOR_BUILD=ld`): the installed plugin launcher threw `NotCapable: Requires --allow-run permissions to spawn subprocess with LD_FOR_BUILD environment variable` at `run.ts:31` (`Command.output()`) after every Write tool result.
- The repo settings hook ended `|| exit 0`, converting any failure into a green exit.
- A finite 8-name scrub list (LD_PRELOAD, LD_LIBRARY_PATH, LD_DEBUG, LD_AUDIT, LD_FOR_BUILD, DYLD_*...) missed other class members; the first smoke with `LD_PRELOAD_64` set re-triggered the crash class.
- The wire test `assert!(run_ts.contains("NotCapable"))` was satisfied by a comment in run.ts, not the catch block — the exact regression it claimed to pin passed CI.

## What Didn't Work

- Scrubbing by finite name list. Deno's sensitive-env check is prefix-based: any `LD_*`/`DYLD_*` variable denies the spawn, so an uncovered name re-triggers the crash class.
- Scrubbing inside run.ts via `Deno.env.delete`. The denial fires inside the spawn regardless of how the env was set, and deletion is itself gated by `--allow-env`.
- A text-grep test for the regression token. If the token lives in a comment (or the fixer's own prose), the test certifies nothing about the mechanism (CHK1).

## Solution

- **Class-level env sweep in the hook command** (POSIX sh, keeps the `--allow-run` allowlist):

```sh
env $(env | awk -F= '$1 ~ /^(LD_|DYLD_)/ { printf "-u %s ", $1 }') deno run --config "${CLAUDE_PLUGIN_ROOT}/hooks/deno.jsonc" --allow-read --allow-run=comment-checker,direnv --allow-env=CLAUDE_PROJECT_DIR,PATH,HOME "${CLAUDE_PLUGIN_ROOT}/hooks/run.ts"
```

- **Absorb every spawn failure in the launcher.** The previous code rethrew non-`NotFound` errors; now `} catch { return undefined }` maps any spawn failure to the binary-unavailable fallback chain, so no environment can turn the hook into a crash.
- **Pin the mechanism, not the token.** The wire test now asserts `run_ts.contains("} catch {") && !run_ts.contains("throw error")` — the structural pair that the old rethrow would violate.

## Why This Works

Deno denies the spawn itself when the process environment carries a sensitive var — inside the spawn, regardless of `env:` merge semantics or allow flags. So the only reliable defenses are (a) scrub the whole prefix class before Deno starts, and (b) never let a denial escape the launcher. The guard's failure mode is silent pass, so the surface must exit `1` (guidance) or `2` (flagged) — never `0` — when nothing ran.

## Prevention

- Scrub env classes by prefix, never by name list; when the runtime's denial is prefix-based, the scrub must be too.
- For a verification mechanism, pin the mechanism (catch-without-rethrow structure, exit-code contract), never a string that can live in a comment. A behavioral smoke (stub binaries on a temp PATH, sensitive var set, real payload piped) is stronger and needs only deno in CI.
- Hooks must never claim a check that did not happen: absent checker -> exit 1 with a bare status line (stderr), flagged comment -> exit 2 with report, and no `|| exit 0` anywhere in the surface. A hook reports state; it never instructs the agent — no `pnpm add`, no "run direnv allow", nothing the model would act on from the hook's own text.

## Related Issues

- Code review run 20260830-212446 (correctness P1/100 env-class, 3 reviewers on the CHK1 wire test).
- Residuals filed: #86 (fail-open stdin decision), #90 (committed launcher smoke), #91 (catch-all conflates spawn-denied with not-found).