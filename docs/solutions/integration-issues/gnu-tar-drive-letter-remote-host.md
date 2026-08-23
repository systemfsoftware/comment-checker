---
title: GNU tar treats a Windows drive letter as a remote host
date: 2026-08-23
category: integration-issues
module: release tarball bundling
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "tar (child): Cannot connect to D: resolve failed"
  - "Cannot write: Broken pipe, exit 2"
  - "The failure appeared only after a changeset-release merge, never on pull_request"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - development_workflow
tags:
  - gnu-tar
  - windows
  - github-actions
  - release-pipeline
---

# GNU tar treats a Windows drive letter as a remote host

## Problem

GNU tar's archive operand uses `host:file` remote syntax. A Windows absolute path `D:\…\name.tar.gz` is parsed as host `D` plus path `\…\name.tar.gz`. On Git Bash the spawned `tar` is GNU tar. The write fails with `Cannot connect to D:` and a broken pipe.

The same command is the GitHub-release tarball step. When it runs only after a merged release PR, the defect is discovered after review, not before.

## Symptoms

- Child tar: `Cannot connect to D: resolve failed`
- Parent tar: `Cannot write: Broken pipe`, non-zero exit
- Ubuntu PR CI green; Windows release lane red

## What Didn't Work

- Passing `--force-local` on every argv. macOS `/usr/bin/tar` is bsdtar and rejects the flag. Darwin release lanes would fail for a Windows-only defect.
- Rehearsing with `$RUNNER_TEMP`. Git Bash already exposes that as `/d/a/…`, so `resolve()` never produces `D:\…` and the drive-letter branch never runs. The rehearsal stays green while the real relative `--out-dir dist/…` still hits `D:`.

## Mechanism

Let $P$ be the archive path handed to GNU tar.

$$
P \sim {}^?[A-Za-z]:[\\/]
\quad\Rightarrow\quad
\text{parsed as remote}\ (host, file)
$$

Deno `resolve` of a relative out-dir on a Windows runner yields $P$ of that form. An already-MSYS path `/d/…` does not match, so a rehearsal that only uses `/d/…` is a different program than release.

bsdtar has no `host:file` parse and no `--force-local`. A flag that is necessary on GNU tar is fatal on bsdtar.

## Solution

Two independent controls, applied only when $P$ is drive-rooted:

1. Rewrite `X:\rest` / `X:/rest` to `/x/rest` (`archivePathForGnuTar`).
2. Prepend `--force-local` (`gnuTarCreateArgs`) only when the *input* matches the drive-rooted pattern.

POSIX absolute paths keep argv `['-czf', dest, member]` — identical to the pre-fix Darwin/Linux lanes.

`writeReleaseTarball` is the single spawn site. The CLI is a thin wrapper.

PR CI must invoke the same *relative* `--out-dir` / `--bin-dir` shape the release job uses, then `tar -tzf` must list the expected member. A presence check on `$RUNNER_TEMP` is not that gate.

## Why This Works

The rewrite removes the colon that GNU tar treats as a host separator. `--force-local` is belt-and-suspenders on the original Windows string. Gating the flag on the drive-rooted *input* (not the rewritten dest) keeps Darwin argv unchanged.

The rehearsal invariant is identity of argv *shape* with release, not identity of temp-dir flavor.

## Architectural Invariants

- **Remote-syntax hygiene.** Never pass a `letter:` prefix to GNU tar unless `--force-local` is set. Prefer a path with no colon.
- **Dialect-specific flags are gated on the input that needs them.** A GNU-only flag is not a global default.
- **A packaging gate must execute the release command shape.** A substitute path that cannot produce the failing class is theater.
- **Presence is not validity.** The member list of the gzip is the observable; `test -f` is not.

## Prevention

- Unit-test `archivePathForGnuTar` / `gnuTarCreateArgs` on the observed `D:\a\…\comment-checker-x86_64-pc-windows-msvc.tar.gz` string. Mutating away the rewrite or the gated flag must fail that suite.
- On `pull_request`, run stage + bundle with relative `dist/release-tarball-<suffix>` and `target/<triple>/release`, including a `windows-2022` row, and require `tar -tzf` to emit the matrix bin name.
- Do not treat an MSYS `/d/…` rehearsal as coverage of the drive-letter branch.

## Related

- docs/solutions/architecture-patterns/rust-cli-npm-distribution.md — release matrix and the rule that a dropped permission fails at tag time
- docs/solutions/integration-issues/cached-gate-task-scope-exceeds-determinants.md — a green gate is not proof the determinant ran
