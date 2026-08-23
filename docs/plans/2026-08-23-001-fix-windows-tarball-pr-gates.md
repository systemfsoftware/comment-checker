---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-23
updated: 2026-08-23
type: fix
---

# Windows tarball + PR packaging gates

Product Contract preservation: new file (`ce-plan-bootstrap`).

## Goal Capsule

- **Objective:** `bundle-release-tarball.ts` produces a `.tar.gz` on `windows-2022` Git Bash, and a `pull_request` job fails if that script (or the other pre-publish packaging scripts) cannot.
- **Product authority:** User-directed. Packaging defects must fail on the PR, not after the changeset-release merge.
- **Open blockers:** None.
- **Execution profile:** code. Two units: fix the bundler; add a PR packaging job on ubuntu + windows.
- **Stop conditions:** A fixture run of the exact release command on a Windows-style out-dir writes a readable gzip, and `ci.yml` runs that rehearsal on `pull_request`.
- **Tail ownership:** LFG after this plan is written.

---

## Product Contract

### Summary

Stop GNU tar treating `D:\…\comment-checker-x86_64-pc-windows-msvc.tar.gz` as host `D`. Run the same packaging scripts on every PR so the next path bug dies before merge.

### Problem Frame

`release.yml` `release` job runs `bundle-release-tarball.ts` only after a merged `changeset-release/master` PR (`release.yml` `if:` at the `release` job). `ci.yml` jobs `gate`, `npm`, and `mutation` are all `ubuntu-latest`. The Windows lane therefore first executes the bundler on a real `D:\a\…` path at publish time.

The bundler does `join(resolve(outDir), \`comment-checker-${target}.tar.gz\`)` then `Deno.Command('tar', { args: ['-czf', tarPath, row.bin], cwd: binDir })` (`scripts/tools/bundle-release-tarball.ts`). The failing run's step shell was Git Bash (`C:\Program Files\Git\bin\bash.EXE` in the job log). Checked-in `release.yml` does not set `shell:` on that step (GitHub default on `windows-2022` is PowerShell). Both can resolve Git's `/usr/bin/tar`. GNU tar's `host:file` form treats `D:` as a remote host. Observed stderr: `tar (child): Cannot connect to D: resolve failed` then `Cannot write: Broken pipe`, exit 2.

`check-matrix` already runs on PRs (`ci.yml` npm job). `stage-platform-package.ts` and `bundle-release-tarball.ts` do not. There is no bundler test under `scripts/`.

### Requirements

**Bundler**

- R1. On `windows-2022` Git Bash, `./scripts/tools/bundle-release-tarball.ts --target x86_64-pc-windows-msvc --bin-dir <dir> --out-dir <dir>` writes `comment-checker-x86_64-pc-windows-msvc.tar.gz` under `--out-dir` and exits 0. A drive-letter out-dir must not be parsed as a tar remote host.
- R2. The archive contains `comment-checker.exe` as a regular file (same member name the release job already uploads).

**PR gates**

- R3. Every `pull_request` (and `push` to `master`) runs a packaging rehearsal that invokes `check-matrix.ts`, `stage-platform-package.ts`, and `bundle-release-tarball.ts` on `ubuntu-latest` and on `windows-2022`. A non-zero exit from any of those scripts fails the PR.
- R4. The Windows rehearsal uses a Windows target row (`x86_64-pc-windows-msvc` / `win32-x64` / `comment-checker.exe`) so the `D:` path class is live, not simulated only on Linux.

The `packaging` job on `pull_request` is the gate. No separate Deno test suite.

### Key Decisions

- KD1. **PR CI must fail packaging, not only Ubuntu lint.** (session-settled: user-directed — chosen over discovering this only on the post-merge changeset-release job: it has to be fixable before merge.) Governs R3, R4.
- KD2. **Rehearse packaging with fixture binaries, not a five-target `cargo build --release` on every PR.** The observed failure is path/`tar`, not the MSVC compile. Governs R3, R4.

### Acceptance Examples

- AE1. Windows drive-letter out-dir
  - **Covers:** R1, R2
  - **Given:** `--out-dir` resolves to a path matching `^[A-Za-z]:[\\/]`
  - **When:** the Windows packaging job runs the release command shape
  - **Then:** the job fails unless a readable archive is written with the expected member
- AE2. PR packaging job
  - **Covers:** R3, R4
  - **Given:** an open pull_request
  - **When:** `ci.yml` runs
  - **Then:** a `windows-2022` job runs the three packaging scripts and fails the check if any exits non-zero

### Scope Boundaries

**In scope**

- `bundle-release-tarball.ts` path/`tar` contract
- `ci.yml` packaging job (ubuntu + windows, fixture bins)

**Deferred**

- Five-target `cargo build --release` on every PR
- `run-binary-smoke.ts` on PRs (needs a real binary, not a fixture)
- Publish, OIDC, tag, GitHub-release, digest-verify jobs
- Rewriting `verify-release-digests.ts` (ubuntu `publish` job only)

**Outside identity**

- Changing the classifier, npm launcher, or publish order

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Extract `archivePathForGnuTar(absPath)` and pass `--force-local`.** Rewrite `^[A-Za-z]:[\\/]` to `/<drive-lower>/<rest with />` and always include `--force-local` on the GNU tar argv. Chosen over an in-process tar writer: no new `@std` archive dep, same `tar` the release job already uses, smallest change that kills `host:file`. `verify-release-digests.ts` stays on ubuntu and is out of scope.
- KTD2. **The packaging job is the proof.** No helper unit suite. Gate: the `windows-2022` row runs the same relative `--out-dir` / `--bin-dir` as release.
- KTD3. **One `packaging` job in `ci.yml`, matrix `ubuntu-latest` + `windows-2022`.** Fixture: write `comment-checker` / `comment-checker.exe` into a temp `--bin-dir`. Ubuntu row uses `x86_64-unknown-linux-gnu` / `linux-x64`; Windows row uses `x86_64-pc-windows-msvc` / `win32-x64`. Do not add those steps to `release.yml`'s post-merge job beyond what already exists.

### Assumptions

- Git Bash on `windows-2022` still resolves `tar` to GNU tar from Git `usr/bin` (the failing log's `/usr/bin/tar`). `--force-local` is a GNU tar flag; if PATH later prefers bsdtar, the MSYS rewrite still avoids `D:`.
- Fixture bytes are enough to prove stage + bundle; smoke stays release-only.

### Sequencing
U1 then U2 in the same PR. The helper must not merge without the `ci.yml` packaging job.

---

## Implementation Units

### U1. GNU-tar-safe archive path

- **Goal:** The bundler never hands GNU tar a `D:\…` archive path.
- **Requirements:** R1, R2
- **Dependencies:** none
- **Files:**
  - `scripts/lib/archive-path-for-gnu-tar.ts` — create
  - `scripts/tools/bundle-release-tarball.ts` — use helper; add `--force-local` only for drive-letter inputs
- **Approach:** Pure helper. Bundler keeps `cwd: binDir` and an absolute archive path. Drive-letter inputs get MSYS rewrite plus `--force-local`. POSIX argv stays `['-czf', dest, member]`.
- **Verification:** the `packaging` job on `windows-2022`.

### U2. PR packaging rehearsal

- **Goal:** `pull_request` CI runs the packaging scripts on Linux and Windows.
- **Requirements:** R3, R4
- **Dependencies:** U1
- **Files:**
  - `.github/workflows/ci.yml` — add `packaging` job
- **Approach:** Job `packaging`, matrix ubuntu + windows-2022. Fixture bins. Same flag names and relative out-dir/bin-dir as `release.yml`. The job failing is the gate.
- **Test scenarios:**
  - `ci.yml` `on.pull_request` includes the new job (actionlint + `check-matrix` still pass).
  - Workflow YAML names `windows-2022` and `x86_64-pc-windows-msvc` on the same matrix row.
  - Missing fixture binary → stage or bundle exits non-zero (rehearsal is not a silent skip).
- **Verification:** `actionlint` on `ci.yml`; locally `deno task check-matrix`; no need to run the Windows job on this Linux worktree.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `cd scripts && deno task lint && deno task check-matrix` | U1, U2 | lint + matrix |
| 2 | `ci.yml` `packaging` job | U1, U2 | ubuntu + windows-2022 fail if stage or bundle fails |
| 3 | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | always | Rust gate unchanged |

No `release:validate`. No classifier mutants.

---

## Definition of Done

- [ ] U1: helper + bundler; drive-letter archive path cannot reach GNU tar as a host.
- [ ] U2: `ci.yml` `packaging` job on ubuntu + windows-2022 runs stage + bundle.
- [ ] Repo one-shot Rust gate still green.
- [ ] No leftover fixture dirs, scratch scripts, or unused archive libraries.

## Risks

- **bsdtar vs GNU tar on PATH.** Mitigation: keep both the MSYS rewrite and `--force-local` on drive-letter inputs only. If `--force-local` is unknown on the runner, do not ship a drop of the flag.
- **Windows job cost.** One Deno + fixture job, not a cargo release build.
- **False green on Ubuntu-only rehearsal.** R4 requires the Windows job so `resolve()` actually produces `D:\`.
