---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-25
updated: 2026-08-25
type: fix
---

# Fix Cargo crate version drift from npm/GitHub release version

## Goal Capsule

- **Objective:** `comment-checker --version` reports the same version as the GitHub release tag (`v0.1.7`) and npm package (`0.1.7`); future releases keep Cargo and npm versions locked.
- **Product authority:** User-directed — "self reported version doesnt match the version thats actually release on gh".
- **Open blockers:** None. Wiki corpus query for version sync between Cargo and npm returned no settled design (query: `version mismatch Cargo.toml package.json release-version sync` with lex/vec/hyde, intent: version synchronization between Rust Cargo crate and npm package in release automation; 2026-08-25; `software-wiki` collection — nil result; top hit was publish-surface concept, unrelated to version sync).
- **Execution profile:** code. Two units: repair current drift and make the release pipeline keep the versions in sync.
- **Stop conditions:** `cargo run -- --version` and `npm/packages/comment-checker/package.json` version and `git tag --list v*` latest tag agree; `release-version.ts` bumps Cargo manifests alongside the npm manifest.
- **Tail ownership:** LFG after this plan is written.

---

## Product Contract

### Summary

The Rust binary reports `0.1.0` while npm and GitHub releases are at `0.1.7`. The classifier crate is the binary the npm launcher executes, so the mismatch is consumer-visible.

### Problem Frame

Measured 2026-08-25 on `master` (`feb47e8`):

- `Cargo.toml` `[workspace.package] version = "0.1.0"` and `crates/comment-checker/Cargo.toml` `version = "0.1.0"` — unchanged since init. `git log -p -- Cargo.toml` shows zero version bumps.
- `npm/packages/comment-checker/package.json` `version = "0.1.7"` — bumped by `scripts/tools/release-version.ts` each version phase. `git tag --list` has `v0.1.7` (and `v0.1.5`, `v0.1.6`), `gh release list` shows `v0.1.7` latest.
- `crates/comment-checker/src/main.rs` uses `#[command(version)]` which reads `CARGO_PKG_VERSION` at compile time — so `comment-checker --version` prints `claude-code-comment-checker 0.1.0`.

Release pipeline state machine (`release.yml` → `plan-release.ts` → `release-version.ts` → PR → merge → `platform.yml` build → `tag-released-packages.ts`):

- `plan-release.ts` decides `phase` from `npm` manifest version tag existence + pending `.changeset/*.md` — Cargo version is not consulted.
- `release-version.ts` bumps only `npm/packages/comment-checker/package.json` (+ `CHANGELOG.md`) and deletes intents.
- `platform.yml` `cargo build --release` embeds whatever `Cargo.toml` says at build time.
- `tag-released-packages.ts` tags `v${npmVersion}` and platform tags — again from npm only.

So every publish builds a binary stamped with the stale `0.1.0` and tags/publishes it as `0.1.7`.

### Requirements

- R1. After a `release-version.ts` version bump, `Cargo.toml` workspace version and `crates/comment-checker/Cargo.toml` version equal the new npm version.
- R2. `comment-checker --version` after `cargo build` reports that same version (no separate embedding step).
- R3. Current drift is repaired: Cargo manifests move to `0.1.7` to match the latest npm/GitHub release.
- R4. The version-mismatch cannot recur silently — a gate fails if Cargo and npm versions diverge on a release branch or in CI.

### Key Decisions

- KD1. **Bump Cargo manifests in `release-version.ts` alongside npm.** (session-settled: user-directed — chosen over build-time embedding of npm version via `env!`/`--manifest` or `VERGEN`: Cargo version is the source of `clap::command(version)` and `Cargo.toml` is the canonical Rust version; mirroring in the version script is the one place versions change.) Governs R1, R2.
- KD2. **Repair drift to `0.1.7` in the same change.** (session-settled: user-directed — chosen over leaving Cargo at `0.1.0` and only fixing future bumps: the next publish would still be mismatched if the fix only applies forward.) Governs R3.
- KD3. **Gate via existing `cargo test` + a `check-matrix` or `tools` step rather than a new workflow.** (session-settled: user-approved — chosen over a new dedicated version-sync job: a lean check in the existing release/tools gate is cheaper and runs on every PR.) Governs R4.

### Acceptance Examples

- AE1. Version bump propagates to Cargo
  - **Covers:** R1, R2
  - **Given:** `npm` version `0.1.7`, Cargo versions `0.1.7`, one `.changeset/*.md` with `patch`
  - **When:** `release-version.ts` runs
  - **Then:** npm becomes `0.1.8`, both `Cargo.toml` files become `0.1.8`, `cargo run -- --version` prints `0.1.8`
- AE2. Drift repaired
  - **Covers:** R3
  - **Given:** current `master` before fix
  - **When:** fix lands
  - **Then:** `Cargo.toml` and `crates/comment-checker/Cargo.toml` are `0.1.7`
- AE3. Gate catches divergence
  - **Covers:** R4
  - **Given:** Cargo `0.1.7`, npm `0.1.8` (manually edited to diverge)
  - **When:** the gate runs
  - **Then:** non-zero exit naming both versions

### Scope Boundaries

**In scope**

- `scripts/tools/release-version.ts` — add Cargo bump
- `Cargo.toml`, `crates/comment-checker/Cargo.toml` — bump to `0.1.7`
- A version-consistency gate (in `scripts/tools/check-matrix.ts` or a small new `scripts/tools/check-versions.ts` invoked from `tools.yml`/`ci.yml`)

**Deferred**

- `publish-surface` verified-artifact changes (unrelated)
- Back-filling already-published npm `0.1.7` tarball or `v0.1.7` binaries (immutable); the fix applies to the next publish

**Outside identity**

- Classifier logic, hook wiring, launcher installation

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Parse and rewrite `Cargo.toml` as text with a narrow `version = "x.y.z"` replacement scoped to the correct table header.** Avoid adding a TOML parser dep to the Deno script; a line-scoped `^[version]\s*=\s*"..."` under `[workspace.package]` and `[package]` is sufficient and mirrors the existing JSON rewrite style. Alternative — `cargo-edit`/`toml` dep — adds toolchain weight for a two-line edit.
- KTD2. **Keep `Cargo.lock` update out of the version script.** `Cargo.lock` is updated by the next `cargo build`/`cargo test` on the branch; the version PR will show a lock diff when built. The version script should not run `cargo` (no `allow-run` needed today; adding it is optional but not required).
- KTD3. **Add a small `check-versions.ts` (or extend `check-matrix.ts`) that asserts `workspace.package.version == crate version == npm version`.** Invoke from `tools.yml` so every PR is gated. The check reads the three files and exits non-zero with a message listing the three versions on mismatch. Chosen over a Rust test: the gate must run even when Rust is cached/skipped.

### Assumptions

- No other `Cargo.toml` in `crates/*` exists beyond `comment-checker` (verified: `glob crates/*/Cargo.toml` returns one). If a second crate appears, the script should bump all `crates/*/Cargo.toml`.
- `Cargo.toml` version line format stays `version = "x.y.z"` with double quotes (current file uses that).

### Sequencing

U1 (drift repair) and U2 (pipeline fix) can land in one commit — drift repair is the same edit the pipeline fix would make. U3 (gate) after, to verify the repaired state.

---

## Implementation Units

### U1. Repair current Cargo version drift

- **Goal:** Cargo manifests match the released npm version `0.1.7`.
- **Requirements:** R3
- **Dependencies:** none
- **Files:**
  - `Cargo.toml` — `[workspace.package] version` `0.1.0` → `0.1.7`
  - `crates/comment-checker/Cargo.toml` — `[package] version` `0.1.0` → `0.1.7`
- **Approach:** Two-line text edits. Keep `Cargo.lock` as-is; it updates on next `cargo build` (or run `cargo update -p claude-code-comment-checker` if a clean lock is desired, but not required for correctness).
- **Test scenarios:** AE2 — `grep version Cargo.toml` and `crates/comment-checker/Cargo.toml` both show `0.1.7`; `cargo run -- --version` prints `0.1.7`.
- **Verification:** `cargo run -- --version` + `cat npm/packages/comment-checker/package.json | jq .version` agree.

### U2. Make `release-version.ts` bump Cargo manifests

- **Goal:** Future version bumps keep Cargo and npm locked.
- **Requirements:** R1, R2
- **Dependencies:** U1
- **Files:**
  - `scripts/tools/release-version.ts` — after bumping `package.json`, also bump `Cargo.toml` and `crates/comment-checker/Cargo.toml` (and any `crates/*/Cargo.toml` via glob)
- **Approach:** After `const next = nextVersion(version, bump)`, read `Cargo.toml` and crate manifests, replace the `version = "..."` line under the correct header with `next`, write back. Add `Crate bump` log line alongside the existing `versioned packages to ${next}`.
- **Test scenarios:** AE1 — create a temp `.changeset/test.md` with `patch`, run the script, assert all three files bumped to `0.1.8`, then revert.
- **Verification:** Dry-run the script against a copy of the manifests or run it and revert; `cargo test` still green.

### U3. Gate version consistency in CI

- **Goal:** Divergence fails the PR gate.
- **Requirements:** R4
- **Dependencies:** U1, U2
- **Files:**
  - `scripts/tools/check-versions.ts` — new, or `scripts/tools/check-matrix.ts` extension — reads `Cargo.toml`, `crates/comment-checker/Cargo.toml`, `npm/packages/comment-checker/package.json`, asserts equality, exits non-zero with `Cargo workspace 0.1.x vs npm 0.1.y` message
  - `.github/workflows/tools.yml` (or `ci.yml`) — invoke the check
- **Approach:** Minimal Deno script with `--allow-read`. No extra deps. Wire into `tools.yml` as a step after `check-matrix.ts`.
- **Test scenarios:** AE3 — temp-edit one file to diverge, run the gate, assert non-zero and message.
- **Verification:** `deno run --allow-read scripts/tools/check-versions.ts` green when aligned, red when diverged.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | U1, U2, U3 | one-shot gate green |
| 2 | `cargo run -- --version` vs `jq .version npm/packages/comment-checker/package.json` vs `git tag --list 'v*' \| sort -V \| tail -1` | U1 | all report `0.1.7` (or next bump) |
| 3 | Create `.changeset/probe.md` with patch, run `scripts/tools/release-version.ts`, check all three manifests bumped, then `git checkout --` to revert | U2 | `Cargo.toml` and crate `Cargo.toml` bumped alongside npm |
| 4 | `deno run --allow-read scripts/tools/check-versions.ts` green; temp-diverge one file → red | U3 | gate enforces R4 |

---

## Definition of Done

- [ ] U1: `Cargo.toml` and `crates/comment-checker/Cargo.toml` are `0.1.7`; `comment-checker --version` reports `0.1.7`.
- [ ] U2: `release-version.ts` bumps Cargo manifests to `next` whenever it bumps npm.
- [ ] U3: CI gate fails on Cargo-vs-npm divergence and passes when aligned.
- [ ] One-shot gate and `cargo test` green; no `*.bak`/`legacy` shims left.

## Risks

- **TOML rewrite fragility.** Mitigation: narrow regex scoped to `[workspace.package]`/`[package]` header; test with AE1 probe before merging.
- **`Cargo.lock` drift.** The lock still references `0.1.0` until next `cargo build`. Mitigation: document that lock updates on next build; optionally run `cargo update -w` in the version PR.
- **Gate placement.** If added to `tools.yml`, it must not require `cargo` toolchain — it only reads files. Deno-only is intentional.
