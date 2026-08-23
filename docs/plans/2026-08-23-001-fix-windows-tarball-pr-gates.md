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
- **Execution profile:** code. Two units: fix the bundler with a test that dies on the observed `D:` argv; add a PR packaging rehearsal on ubuntu + windows.
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

**Tests**

- R5. A Deno test fails if the argv handed to `tar` contains a `^[A-Za-z]:` archive path without `--force-local` (or equivalent local-only form). Replaying today's `resolve(outDir)` Windows path must fail that test until the helper rewrites it.

### Key Decisions

- KD1. **PR CI must fail packaging, not only Ubuntu lint.** (session-settled: user-directed — chosen over discovering this only on the post-merge changeset-release job: it has to be fixable before merge.) Governs R3, R4.
- KD2. **Rehearse packaging with fixture binaries, not a five-target `cargo build --release` on every PR.** The observed failure is path/`tar`, not the MSVC compile. Governs R3, R4.

### Acceptance Examples

- AE1. Windows drive-letter out-dir
  - **Covers:** R1, R2, R5
  - **Given:** `--out-dir` resolves to a path matching `^[A-Za-z]:[\\/]`
  - **When:** the bundler builds the `tar` argv and writes the archive
  - **Then:** that argv is not `['-czf', 'D:\\…\\file.tar.gz', …]` without a local-only flag; `tar` exit is 0; the `.tar.gz` exists; listing it shows `comment-checker.exe` as a regular member
- AE2. PR packaging job
  - **Covers:** R3, R4
  - **Given:** an open pull_request
  - **When:** `ci.yml` runs
  - **Then:** a `windows-2022` job runs the three packaging scripts and fails the check if any exits non-zero

### Scope Boundaries

**In scope**

- `bundle-release-tarball.ts` path/`tar` contract
- Deno test for the archive-path helper
- `ci.yml` packaging rehearsal (ubuntu + windows, fixture bins)

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
- KTD2. **Test the helper, not the GitHub runner.** `scripts/lib/archive-path-for-gnu-tar_test.ts` (or colocated `*_test.ts` per Deno) feeds the exact Windows string `D:\\a\\comment-checker\\comment-checker\\dist\\release-tarball-win32-x64\\comment-checker-x86_64-pc-windows-msvc.tar.gz` and asserts the output has no `D:` host prefix and that bundler argv includes `--force-local`. Gate: `deno test` in `scripts/`.
- KTD3. **One `packaging` job in `ci.yml`, matrix `ubuntu-latest` + `windows-2022`.** Fixture: write `comment-checker` / `comment-checker.exe` into a temp `--bin-dir`. Ubuntu row uses `x86_64-unknown-linux-gnu` / `linux-x64`; Windows row uses `x86_64-pc-windows-msvc` / `win32-x64`. Do not add those steps to `release.yml`'s post-merge job beyond what already exists.

### Assumptions

- Git Bash on `windows-2022` still resolves `tar` to GNU tar from Git `usr/bin` (the failing log's `/usr/bin/tar`). `--force-local` is a GNU tar flag; if PATH later prefers bsdtar, the MSYS rewrite still avoids `D:`.
- Fixture bytes are enough to prove stage + bundle; smoke stays release-only.

### Sequencing
U1 then U2 in implementation order. Both land in the same PR. The helper must not merge without the `ci.yml` packaging job and the `deno task test` npm step.

---

## Implementation Units

### U1. GNU-tar-safe archive path

- **Goal:** The bundler never hands GNU tar a `D:\…` archive path.
- **Requirements:** R1, R2, R5
- **Dependencies:** none
- **Files:**
  - `scripts/lib/archive-path-for-gnu-tar.ts` — create
  - `scripts/lib/archive-path-for-gnu-tar_test.ts` — create
  - `scripts/tools/bundle-release-tarball.ts` — use helper; add `--force-local`
  - `scripts/deno.jsonc` — add `test` task (`deno test --allow-read --allow-write --allow-run=tar --allow-env`)
- **Approach:** Pure helper. Bundler keeps `cwd: binDir` and an absolute archive path (the existing comment is still true). Argv becomes `['--force-local', '-czf', archivePathForGnuTar(tarPath), row.bin]`.
- **Test scenarios:**
  - Input `D:\a\comment-checker\comment-checker\dist\release-tarball-win32-x64\comment-checker-x86_64-pc-windows-msvc.tar.gz` → output starts with `/d/` and contains no `D:`.
  - Input `C:/Users/x/out/a.tar.gz` → `/c/Users/x/out/a.tar.gz`.
  - POSIX `/tmp/out/a.tar.gz` is unchanged.
  - A raw Windows path used as `-czf` dest without `--force-local` is a failing fixture (documents today's bug).
  - Integration: temp bin dir + `--target x86_64-unknown-linux-gnu` (or win32 row if the test host is Windows) writes a gzip whose first two bytes are `1f 8b` and whose member name is that row's `bin`.
- **Verification:** `cd scripts && deno task test`. Gate fails if the helper returns a `^[A-Za-z]:` string.

### U2. PR packaging rehearsal

- **Goal:** `pull_request` CI runs the packaging scripts on Linux and Windows.
- **Requirements:** R3, R4
- **Dependencies:** U1
- **Files:**
  - `.github/workflows/ci.yml` — add `packaging` job; extend the npm job Deno step to `deno task lint && deno task test && deno task check-matrix`
  - `scripts/deno.jsonc` — `test` task (shared with U1)
  - actionlint path list in the npm job already names `ci.yml`
- **Approach:** Job `packaging`, `strategy.matrix.include` two rows. Setup Deno. Create fixture `--bin-dir` with the row's `bin` name. Run from repo root (same CWD as `release.yml`; `stage-platform-package.ts` reads `npm/packages/comment-checker/package.json` relatively). Run `./scripts/tools/check-matrix.ts`, `stage-platform-package.ts`, `bundle-release-tarball.ts` with the same flag names as `release.yml`. Assert the `.tar.gz` exists (`if-no-files-found` via a shell test). Windows packaging steps use `shell: bash` so the rehearsal matches the failing log's Git Bash `tar`. The npm job is the home of `deno task test` so R5 runs on every PR.
- **Test scenarios:**
  - `ci.yml` `on.pull_request` includes the new job (actionlint + `check-matrix` still pass).
  - Workflow YAML names `windows-2022` and `x86_64-pc-windows-msvc` on the same matrix row.
  - Missing fixture binary → stage or bundle exits non-zero (rehearsal is not a silent skip).
- **Verification:** `actionlint` on `ci.yml`; locally `deno task check-matrix`; no need to run the Windows job on this Linux worktree.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `cd scripts && deno task test` | U1 | helper cases + gzip smoke + member name |
| 2 | `cd scripts && deno task lint && deno task test && deno task check-matrix` | U1, U2 | same command the npm job must run |
| 3 | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | always | Rust gate unchanged |
| 4 | actionlint on `ci.yml` | U2 | existing npm job step, or local `actionlint` |
| 5 | Manual argv assertion | U1 | test file contains the observed `D:\\a\\comment-checker\\…` string as a failing-without-helper case |

No `release:validate`. No classifier mutants.

---

## Definition of Done

- [ ] U1: helper + bundler + Deno tests; `D:\…` archive path cannot reach GNU tar as a host.
- [ ] U2: `ci.yml` `packaging` job on ubuntu + windows-2022 runs check-matrix, stage, bundle; npm job runs `deno task test`.
- [ ] Repo one-shot Rust gate still green.
- [ ] No leftover fixture dirs, scratch scripts, or unused archive libraries.

## Risks

- **bsdtar vs GNU tar on PATH.** Mitigation: keep both the MSYS rewrite and `--force-local`. If `--force-local` is unknown on the runner, do not ship a drop of the flag. File a follow-up that adds an equivalent local-only form or shows the rewrite against that tar in CI logs. The U1 test still requires `--force-local` in argv.
- **Windows job cost.** One Deno + fixture job, not a cargo release build.
- **False green on Ubuntu-only helper tests.** R4 requires the Windows job so `resolve()` actually produces `D:\`.
