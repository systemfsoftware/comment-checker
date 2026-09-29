---
title: "A hook command that exits before draining stdin breaks the host with EPIPE — every exit other than the checker's own 0 or 2 drains first"
date: 2026-09-29
category: integration-issues
module: hooks (PostToolUse hook surfaces)
problem_type: integration_issue
component: dev-tooling
symptoms:
  - "The npm README's bare `comment-checker` hook command exited 127 on a host without the binary, before reading the payload: the write went unchecked with no guidance"
  - "Hosts that pipe the hook payload (omp with omp-claude-compat) died with EPIPE once the payload outgrew the 64 KiB pipe buffer"
  - "A fallback that prints the did-not-run guidance and exits 1 still EPIPEs: printing is not draining"
root_cause: logic_error
resolution_type: documentation_update
severity: high
tags: [hook, stdin-drain, epipe, direnv, posix-shell, silent-pass, gatekeeper]
---

# A hook command that exits before draining stdin breaks the host with EPIPE

## Problem

A PostToolUse hook receives the tool payload on stdin. A hook command that exits on any path without reading all of it leaves the host's writer blocked on a full pipe, and the writer gets EPIPE when the reader closes. Issue #110 found this in the npm README's Quick Start snippet; issue #112 found the same defect in the repo's own `settings.json` hook and in the plugin hook (`hooks.json` launching `run.ts`).

## Symptoms

- `printf '%s' '{}' | sh -c comment-checker` on a host without the binary prints `comment-checker: command not found` and exits 127 before touching stdin.
- With a 1 MiB payload piped in, the writer sees `BrokenPipe` (errno 32). Per issue #110, omp with omp-claude-compat treats that as fatal and dies at the end of every turn.
- The repo's own `settings.json` hook prints `comment-checker did not run — nothing checked this write.` and exits 1, and its writer still hits `BrokenPipe`. The guidance line looks like the fix, but the payload is never read.
- The plugin launcher `run.ts` reproduces the same `BrokenPipe` when neither `comment-checker` nor `direnv` spawns. Its children inherit stdin (`stdin: 'inherit'`), and the launcher's final fallback exits 1 without reading it.

## What Didn't Work

- **Guidance plus `exit 1`, no drain.** The exit contract is right and it still EPIPEs. The issue's premise that the settings hook "already handles all of this" was wrong on this axis.
- **`exec direnv exec DIR comment-checker` as the fallback.** When direnv is installed but cannot resolve the checker (blocked `.envrc`, no `.envrc`), direnv fails before reading stdin. Because of `exec`, the shell never reaches the fallback.
- **`exec comment-checker` on the PATH branch.** A checker that crashes before reading stdin (a panic, a missing dynamic library) exits in place of the shell, so nothing drains and the writer gets EPIPE again. Any exit code outside the 0/2 contract also leaked through to the host.
- **Treating direnv's exit 127 as "not found".** direnv 2.37 exits 1, not 127, when the command is missing from the project env, and also exits 1 for a blocked `.envrc`. Resolving the checker inside the direnv env (`sh -c 'command -v comment-checker || exit 127; exec comment-checker'`) makes 127 mean "not found".
- **A tiny-payload test.** EPIPE needs a payload larger than the pipe buffer. A `{}` payload passes against every broken variant.
- **A pipe-only drain check.** Up to one pipe buffer (64 KiB) can still sit unread when the child exits, so "the writer saw no EPIPE" does not prove every byte was consumed.

## Solution

The README's documented hook command is now:

```sh
if command -v comment-checker >/dev/null 2>&1; then
  comment-checker
  rc=$?
elif command -v direnv >/dev/null 2>&1; then
  direnv exec "${CLAUDE_PROJECT_DIR:-$PWD}" sh -c 'command -v comment-checker >/dev/null 2>&1 || exit 127; exec comment-checker'
  rc=$?
  [ "$rc" -eq 127 ] && rc=
else
  rc=
fi
case "$rc" in 0|2) exit "$rc" ;; esac
cat >/dev/null
if [ -z "$rc" ]; then
  echo "comment-checker did not run — nothing checked this write." >&2
else
  echo "comment-checker failed (exit $rc) — nothing checked this write." >&2
fi
exit 1
```

- Neither branch uses `exec`, so the shell always regains control after the checker exits.
- PATH is tried first. Once the PATH checker has run, the command never falls through to direnv.
- Only the checker's contract codes 0 and 2 pass through. Every other outcome drains (`cat >/dev/null`), reports, and exits 1. It never exits 0 when nothing was checked.
- An empty `rc` means nothing resolved the checker: the did-not-run line. Any other code means something ran and failed: `comment-checker failed (exit $rc)`.
- direnv is anchored to `CLAUDE_PROJECT_DIR`, matching `setup-resolution.md` and the `run.ts` launcher. The hook's cwd follows the session, not the project.

The gatekeeper `hook_commands.rs` runs the exact text each surface ships:

- `readme_hook_command` and `plugin_hook_command` read the README's `json` fences and `hooks.json` with `include_str!` and require exactly one PostToolUse command hook each. They never copy a command. `repo_settings_hook_runs_the_readme_hook_command` requires the repo's `settings.json` to wire the README's command byte for byte, so the README cases cover it too.
- Every outcome case runs once per `Surface` (README, plugin). The hook runs as `<host sh> -c <command>` with `env_clear()`, a `PATH` holding only the host tools that surface needs (`cat`, `sh`, plus `env`, `awk` and a `deno` wrapper that adds `--cached-only` for the plugin) and the stubs a case installs, a cwd outside the project, and `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_ROOT` set. `DENO_WITH_WARM_CACHE` checks once that `run.ts`'s imports are already cached, so a cold cache fails with the warm-up command instead of fetching mid-test.
- The payload is over 1 MiB (`CONTENT_LARGER_THAN_ANY_PIPE_BUFFER`), and drain is proven two ways:
  - `pipe_from_writer_thread`: `write_all` from a writer thread must return Ok.
  - `bytes_read_through_shared_file_offset`: stdin is a regular file passed through `File::try_clone()`. The child shares the open file description, so after it exits `stream_position()` must equal the payload length. That is an exact count of the bytes consumed.
- Cases: no checker and no direnv; a direnv whose project env lacks the checker (did not run); a blocked `.envrc` (`install_direnv_blocked_by_envrc`, failed with exit 1); a checker that exits 101 without reading stdin, on `PATH` and behind direnv, plus exit 127 on `PATH` (failed with that code); and a stub checker on `PATH` and behind direnv that exits 0 and 2, with the payload captured byte-for-byte and no unchecked-write line on stderr. The direnv stub refuses any directory but `CLAUDE_PROJECT_DIR` and, like direnv 2.37, exits 1 when the command is missing (`install_direnv_loading_project_env`). Plugin-only cases: `deno` missing, `deno` dying before `run.ts` reports, and `CLAUDE_PROJECT_DIR` unset (all did not run).

The plugin hook splits the work. `run.ts` resolves and runs the checker, and on any unchecked outcome drains stdin, prints the matching line, and exits 3. The `hooks.json` command maps 3 to exit 1, and for any other exit outside 0 and 2 (a missing `deno`, or `deno` dying before `run.ts` could report) it drains with `cat >/dev/null`, prints the did-not-run line, and exits 1. Exit 3 is how the shell tells "the launcher already reported" apart from "the launcher never ran": both would otherwise be 1. A checker that itself exits 3 must still read as `failed (exit 3)`; the crash cases include 3 so a pass-through regression prints nothing and fails.

The direnv stubs model two facts about real direnv: a blocked `.envrc` exits 1 without running the command, and a command missing from the loaded env exits 1. `real_direnv_exits_1_without_running_the_command_when_envrc_is_blocked_or_command_is_missing` checks both against the host's direnv (CI installs it; locally the test skips with a message when direnv is absent).

## Why This Works

**Invariant: a hook command exits 0 or 2 only with the checker's own verdict. Every other exit first reads stdin to EOF, then reports, then exits 1.** The host needs two things: its payload consumed, and an honest exit code. A checker that answered 0 or 2 has already read its stdin. Every other path is the command's own responsibility, and `cat >/dev/null` consumes whatever the checker, direnv, or PATH lookup left behind.

```text
wrong: resolve || { report; exit 1; }            # payload never read -> writer EPIPE past 64 KiB
wrong: resolve && exec checker; drain; exit 1    # a crashing checker leaves the payload unread
right: run checker; 0|2 -> exit rc; else drain; report(rc); exit 1
```

While the fix was being developed, six substitutions of the README command were run against the gatekeeper and every one failed it: the bare command, a copy of the settings-hook command, an `|| exit 0` swallow, `head -c 1000`, `head -c 1040000`, and an `exec direnv` chain.

## Prevention

- Treat "reads all of stdin" as part of a hook's exit contract, next to "never exit 0 when nothing ran" from `docs/solutions/runtime-errors/deno-env-sensitive-spawn-crash-silent-pass-hook.md`.
- A test of a hook surface pipes more than one pipe buffer and proves the byte count, not only the absence of EPIPE. The shared-file-offset run is cheap and exact.
- Test the text users copy (`include_str!` of the shipped doc), never a restatement of it.
- Grep-able smell: a hook command or launcher whose failure branch runs `exit 1` (or `Deno.exit(1)`) without a preceding stdin read.

## Related Issues

- #110: the README snippet; the fix is in #111.
- #112: the repo settings hook and the plugin hook.
- `docs/solutions/runtime-errors/deno-env-sensitive-spawn-crash-silent-pass-hook.md`: same hook surfaces and exit contract. It predates the drain rule.
- `docs/solutions/integration-issues/diagnostic-hook-needs-fixtures-on-both-sides.md`: the PATH-first, direnv-fallback resolution model, and fixtures on both sides of a boundary.
