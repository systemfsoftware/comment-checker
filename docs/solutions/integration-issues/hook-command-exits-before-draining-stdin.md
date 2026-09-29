---
title: "A hook command that exits before draining stdin breaks the host with EPIPE — drain on every path that does not exec the checker"
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

A PostToolUse hook receives the tool payload on stdin. A hook command that exits on any path without reading all of it leaves the host's writer blocked on a full pipe, and the writer gets EPIPE when the reader closes. Issue #110 found this in the npm README's Quick Start snippet. The repo's other two hook surfaces have the same defect.

## Symptoms

- `printf '%s' '{}' | sh -c comment-checker` on a host without the binary prints `comment-checker: command not found` and exits 127 before touching stdin.
- With a 1 MiB payload piped in, the writer sees `BrokenPipe` (errno 32). Per issue #110, omp with omp-claude-compat treats that as fatal and dies at the end of every turn.
- The repo's own `settings.json` hook prints `comment-checker did not run — nothing checked this write.` and exits 1, and its writer still hits `BrokenPipe`. The guidance line looks like the fix, but the payload is never read.
- The plugin launcher `run.ts` reproduces the same `BrokenPipe` when neither `comment-checker` nor `direnv` spawns. Its children inherit stdin (`stdin: 'inherit'`), and the launcher's final fallback exits 1 without reading it.

## What Didn't Work

- **Guidance plus `exit 1`, no drain.** The exit contract is right and it still EPIPEs. The issue's premise that the settings hook "already handles all of this" was wrong on this axis.
- **`exec direnv exec DIR comment-checker` as the fallback.** When direnv is installed but cannot resolve the checker (blocked `.envrc`, no `.envrc`), direnv fails before reading stdin. Because of `exec`, the shell never reaches the fallback.
- **A tiny-payload test.** EPIPE needs a payload larger than the pipe buffer. A `{}` payload passes against every broken variant.
- **A pipe-only drain check.** Up to one pipe buffer (64 KiB) can still sit unread when the child exits, so "the writer saw no EPIPE" does not prove every byte was consumed.

## Solution

The README's documented hook command is now:

```sh
command -v comment-checker >/dev/null 2>&1 && exec comment-checker
if command -v direnv >/dev/null 2>&1; then
  direnv exec "${CLAUDE_PROJECT_DIR:-$PWD}" comment-checker
  rc=$?
  case $rc in 0|2) exit $rc ;; esac
fi
cat >/dev/null
echo "comment-checker did not run — nothing checked this write." >&2
exit 1
```

- `exec` appears only on the path that hands stdin to the checker itself.
- direnv runs without `exec`. Only the checker's contract codes 0 and 2 pass through, and everything else falls through.
- Every fall-through path drains (`cat >/dev/null`), prints the guidance, and exits 1. It never exits 0 when nothing was checked.
- direnv is anchored to `CLAUDE_PROJECT_DIR`, matching `setup-resolution.md` and the `run.ts` launcher. The hook's cwd follows the session, not the project.

The gatekeeper `readme_hook.rs` runs the exact text the README ships:

- `readme_hook_command` reads the README with `include_str!`, parses every `json` fence, and requires exactly one PostToolUse command hook. It never copies the command.
- The hook runs as `<host sh> -c <command>` with `env_clear()`, a `PATH` holding only a `cat` symlink plus the stubs a case installs, a cwd outside the project, and `CLAUDE_PROJECT_DIR` set.
- The payload is over 1 MiB (`CONTENT_LARGER_THAN_ANY_PIPE_BUFFER`), and drain is proven two ways:
  - `pipe_from_writer_thread`: `write_all` from a writer thread must return Ok.
  - `bytes_read_through_shared_file_offset`: stdin is a regular file passed through `File::try_clone()`. The child shares the open file description, so after it exits `stream_position()` must equal the payload length. That is an exact count of the bytes consumed.
- Cases: no checker and no direnv; a direnv stub that fails before reading stdin (`install_direnv_failing_before_stdin`); a stub checker on `PATH` (exit 0 and 2, payload captured byte-for-byte); and a direnv stub that refuses any directory but `CLAUDE_PROJECT_DIR` (`install_direnv_loading_project_env`).

## Why This Works

**Invariant: a hook command either execs the checker or reads stdin to EOF before it exits.** The host needs two things: its payload consumed, and an honest exit code (0 or 2 only when the checker ran, 1 when it did not). Once the command execs the checker, the checker owns stdin and reads it to EOF. Every other path is the command's own responsibility, and `cat >/dev/null` consumes it whatever state PATH or direnv left behind.

```text
wrong: resolve || { report; exit 1; }            # payload never read -> writer EPIPE past 64 KiB
right: resolve && exec checker; drain; report; exit 1
```

While the fix was being developed, six substitutions of the README command were run against the gatekeeper and every one failed it: the bare command, a copy of the settings-hook command, an `|| exit 0` swallow, `head -c 1000`, `head -c 1040000`, and an `exec direnv` chain.

## Prevention

- Treat "reads all of stdin" as part of a hook's exit contract, next to "never exit 0 when nothing ran" from `docs/solutions/runtime-errors/deno-env-sensitive-spawn-crash-silent-pass-hook.md`.
- A test of a hook surface pipes more than one pipe buffer and proves the byte count, not only the absence of EPIPE. The shared-file-offset run is cheap and exact.
- Test the text users copy (`include_str!` of the shipped doc), never a restatement of it.
- Grep-able smell: a hook command or launcher whose failure branch runs `exit 1` (or `Deno.exit(1)`) without a preceding stdin read. The settings hook and the `run.ts` fallback both still match as of this writing.

## Related Issues

- #110: this issue. As of this writing, the fix is pending in the PR for #110.
- `docs/solutions/runtime-errors/deno-env-sensitive-spawn-crash-silent-pass-hook.md`: same hook surfaces and exit contract. It predates the drain rule.
- `docs/solutions/integration-issues/diagnostic-hook-needs-fixtures-on-both-sides.md`: the PATH-first, direnv-fallback resolution model, and fixtures on both sides of a boundary.
