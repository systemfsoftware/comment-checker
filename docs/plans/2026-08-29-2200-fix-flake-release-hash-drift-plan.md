---
title: Fix flake release-asset hash drift - Plan
type: fix
date: 2026-08-29
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Fix flake release-asset hash drift

Origin: https://github.com/systemfsoftware/comment-checker/issues/81

## Goal Capsule

- **Objective:** A `nix build .#comment-checker` yields the binary of the crate version the flake declares; the four `flake.nix` `hash` entries always equal the bytes of the release assets for that version; the plugin hook's `--strip` call works from the nix-installed binary; the state holds on future releases.
- **Means:** Refresh the stale `flake.nix` hash set to the live v0.3.2 asset SRIs; add publish-phase hash auto-sync; add a gate that recomputes the hashes from live release assets; add a `--version` assertion to the binary smoke gate (KTD1-KTD3).
- **Authority:** This plan is authoritative for the change. Issue #81 defines the acceptance criteria and boundaries; nothing here relaxes them.
- **Stop conditions:** Stop when a release asset is re-uploaded with different bytes than verified, when Nix changes fixed-output derivation semantics, or when `check-versions.ts` gate behavior conflicts with the release sequence.
- **Execution profile:** One PR. Units U1, U3, U4 mutate repo files; U2 adds a release step. Sequential applies in one working tree.
- **Tail ownership:** The PR is pushed and opened by the shipping pipeline; the follow-up hash-sync PR on the next release is opened by the release workflow itself (U2).

## Product Contract

### Summary

The v0.3.2 release assets on GitHub are already correct: the `x86_64-unknown-linux-gnu` asset reports `claude-code-comment-checker 0.3.2`, `--help` lists `--strip`, and the `--strip` hook probe exits 2 with a findings report. The defect is that `flake.nix` still declares the v0.1.5-era SRI hash set (set once in commit `403d2d079`, never updated by `release-version.ts`, which bumps only the `version =` string). Nix fixed-output derivations cache by name + declared hash, so the store path `0yxkwm3r09fdbvr2pnhpbajiw01dp3i4-comment-checker-0.3.2` serves the stale 0.1.0 binary without ever fetching the real v0.3.2 asset. This plan refreshes the hashes, makes publishing keep them in sync, and gates the state.

### Problem Frame

Every changeset release after #48 bumped the crate, npm, and flake `version` strings but never the four asset hashes. The `fetchurl` call passes no name (its FOD store name derives from the URL basename `comment-checker-<triple>`, no version); the version appears only in the derivation output name (`comment-checker-0.3.2`, `pname` + `version`). The fixed-output path is keyed on name + declared hash either way, so bumping the version string alone cannot invalidate the cache. Warm stores serve the cached 0.1.0-era bytes under the new version name; cold stores fail with a hash mismatch. Consumers — this repo's plugin hook and any flake following `github:systemfsoftware/comment-checker` — silently run a binary from six releases ago that lacks `--strip`.

### Requirements

**Release assets**

- R1. For the version `flake.nix` declares, each release asset at `releases/download/v<version>/comment-checker-<triple>` is a binary built from that crate version: `--version` reports it and `--help` lists `--strip`.
- R2. The four `flake.nix` `hash` entries match the bytes of the live release assets for the declared version, and each differs from the v0.1.5 hash set (`d/Xl2VZqn…`, `vP0Ss8eO…`, `c0mJOCcz…`, `C/f81qw86…`).

**Nix behavior**

- R3. `nix build .#comment-checker` fetches and serves the asset described by R1, not cached bytes predating the declared version.

**Hook path**

- R4. Piping `{"tool_input":{"file_path":"x.ts","content":"/** Gate: test */\nconst x=1;\n"}}` to the built binary with `--strip` exits 2 with a comment-findings report, not clap usage text.

**Durability**

- R5. The state in R1-R3 holds on future releases: publishing keeps `flake.nix` hashes in sync with the published assets, and a deterministic gate verifies the sync.

### Scope Boundaries

- In scope: `flake.nix` hash refresh; release-publish hash sync; `check-versions.ts` gate; `run-binary-smoke.ts` version assertion; the workflows that invoke them.
- Out of scope: deleting or editing the historical `v0.1.5` / `v0.1.0` tags (issue boundary — ask the user first); re-uploading or re-creating any release; changing how the npm launcher resolves platform binaries; editing document-level `--version` output format of the crate.
- Deferred to follow-up work: a `--version` check inside the nix derivation itself (the gate covers the same property without touching the store).

### Sources / Research

- Issue #81 evidence and acceptance criteria (verbatim acceptance 1-4).
- Measured this session: live v0.3.2 asset SHA-256 digests via the GitHub API (`656ab715…`, `3713273294…`, `f11199fd…`, `47ad8373…`) and `nix hash file --sri` on the downloaded bytes; v0.1.5 asset digests (`77f5e5d9…`, `bcfd12b3…`, `73498938…`, `0bf7fcd6…`); flake SRI `d/Xl2VZqn…` decodes to `77f5e5d9…` (the v0.1.5 linux-x64 bytes); store path `0yxkwm3r09fdbvr2pnhpbajiw01dp3i4` built in 0.35s from cache and its `bin/comment-checker --version` prints `0.1.0` (6100-byte-larger stale binary).
- Nix fixed-output derivation semantics: store path keyed on name + declared output hash; URL changes do not invalidate it — Nix manual `advanced-attributes`, nixpkgs `fetchurl/default.nix`, garnix "Fix your FODs", Nix issue #7999. Versioning the derivation output name (`comment-checker-0.3.2`) does not prevent stale reuse of the fetchurl FOD when the declared hash is unchanged ([Nix manual](https://nixos.org/manual/nix/2.22/language/advanced-attributes), [garnix blog](https://garnix.io/blog/fix-your-fods/)).

## Planning Contract

### Key Technical Decisions

- KTD1. **Current-state fix is a hash refresh, not a new release.** The v0.3.2 assets are byte-correct (measured: version, `--strip`, digest set), so the fix writes the four live SRIs into `flake.nix`. Chosen over bumping to a new tag and re-publishing: no binary change exists to publish, and a new tag would churn the version surface for zero behavioral gain.
- KTD2. **Recurrence prevention is publish-phase auto-sync plus a recomputing gate.** The release publish job, after `create-github-release.ts`, computes the four flat SHA-256s of the just-built binaries and opens a PR that writes them into `flake.nix` (U2). `check-versions.ts` is extended to recompute the hashes from the live release assets for the declared version whenever that tag exists, and to fail on mismatch (U3). Chosen over a manual runbook step (human-dependent, recurs at the next release) and over the gate alone (auto-sync closes the window; the gate makes a failed sync visible on the next push).
- KTD3. **The binary smoke gate asserts `--version`.** `run-binary-smoke.ts` gains an assertion that the built binary's `--version` output equals the crate version in `Cargo.toml`. Chosen over leaving the rc-only smoke: the 0.1.0-era binaries passed the old smoke exactly because it never checked the version string.

### High-Level Technical Design

```mermaid
flowchart TB
  subgraph Release workflow (publish job, runs on master)
    A[release.yml publish] --> B[create-github-release.ts]
    B --> C[sync-flake-hashes.ts: hash the 4 extracted binaries]
    C --> D[write SRI set into flake.nix on a branch]
    D --> E[open hash-sync PR via gh]
  end
  subgraph Gates (every PR + push to master)
    F[check-versions.ts = version surface check + flake-hash-vs-live-assets check]
    G[run-binary-smoke.ts --version assertion on each platform build]
  end
  H[flake.nix with correct SRIs] --> I[nix build serves the declared-version binary]
```

New step `sync-flake-hashes.ts` runs only in the publish phase after the GitHub release exists, so the assets it hashes are the ones consumers will fetch. The gate verifies the same invariant on the other side of publishing.

### Assumptions

- The live v0.3.2 release assets are authoritative and correct bytes (measured this session; the issue's "same bytes as v0.1.5" claim describes `flake.nix` state, not the current assets).
- No changeset is required: this PR touches no npm or cargo version surface (prior tool-only changes such as #78 shipped without one).
- Master stays the publication branch; the hash-sync PR follows the repo's never-commit-to-master rule.

## Implementation Units

### U1. Refresh flake.nix hash block to live v0.3.2 asset SRIs

- **Goal:** `flake.nix` declares the hash set of the live v0.3.2 assets so `nix build` fetches the correct binary.
- **Requirements:** R1, R2, R3.
- **Files:** `flake.nix`.
- **Approach:** Replace the four SRI values in the `hash = { … }` block. Values measured from the downloaded assets with `nix hash file --type sha256 --sri`:
  - `x86_64-unknown-linux-gnu` = `sha256-ZWq3FcS8ILUCVNrC8u4jHCltywXNNuZAluF8IOK5BnI=`
  - `aarch64-unknown-linux-gnu` = `sha256-NxMnMpTcXQ/A1D2cZRbXDfYJEL+bqqJQphwWM3YZ7+M=`
  - `x86_64-apple-darwin` = `sha256-8RGZ/X6hFJe0sEHnD0OCJ7BF1iQX6DrGt0qAwYs78ho=`
  - `aarch64-apple-darwin` = `sha256-R62Dc6QVr64K5N/HPIDkfG6hXx9JUy/o43451wzpbNw=`
  Leave `version = "0.3.2"` and every other line untouched.
- **Test Scenarios:**
  - T1.1 Decode each new SRI with base64 and compare to the API-returned asset digests (`656ab715…`, `3713273294…`, `f11199fd…`, `47ad8373…`) — all four match.
  - T1.2 Each new SRI differs from the v0.1.5 SRI set.
  - T1.3 `nix build --no-link --print-out-paths .#comment-checker` yields a store path for `comment-checker-0.3.2` distinct from `0yxkwm3r09fdbvr2pnhpbajiw01dp3i4` (the stale one), and a cold fetch succeeds.
- **Verification:** `nix build --no-link --print-out-paths .#comment-checker`; `$out/bin/comment-checker --version`; `$out/bin/comment-checker --help`; decode-compare against the API digests.

### U2. Publish-phase flake hash sync

- **Goal:** every future release updates `flake.nix` hashes to the just-published bytes without a human step.
- **Requirements:** R5.
- **Files:** `scripts/tools/sync-flake-hashes.ts` (new), `.github/workflows/release.yml`, `scripts/lib/version-files.ts` (reuse `replaceNixVersion` pattern — extend for hash rewrite), `scripts/tools/lint-workflows.ts` (workflow lint gate).
- **Approach:** New Deno script run after `create-github-release.ts` in the publish job, following the repo's existing script conventions (shebang, Effect where the lib uses it, `gh` for PR creation as `create-or-update-release-pr.ts` does):
  1. Read the version from the launcher manifest `npm/packages/comment-checker/package.json` (the `MANIFEST` `create-github-release.ts` reads) and the four non-Windows target triples from `scripts/lib/targets.json` — skip the `x86_64-pc-windows-msvc` row, which has no key in the flake hash block. U3 applies the same filter.
  2. Hash `release-assets/binaries/comment-checker-<triple>` (the files `create-github-release.ts` extracted; five binaries exist, four belong to the filter in step 1) with SHA-256 and encode as SRI.
  3. Rewrite the `hash = { … }` block in `flake.nix` when any value differs; otherwise exit cleanly.
  4. Create a branch `fix/flake-hashes-v<version>`, commit only `flake.nix` (`git add -- flake.nix` — the publish job's tree is dirty with downloaded artifacts; a full `git add -A` would sweep binaries and staged packages into the PR), push, open a PR titled `fix(flake): sync v<version> release asset hashes`. Then attempt `gh pr merge --auto --squash` so the sync merges when CI passes; if branch protection denies bot auto-merge, leave the PR open and let the next release's plan job encounter it. On an existing open PR for the same version, update it instead.
  5. Fail the job loudly on any hash write that does not round-trip (re-read the file and compare).
  Wire as a new step in `release.yml` publish after the `Create GitHub release` step, with the existing `GH_TOKEN` env. Add `pull-requests: write` to the publish job's `permissions` block (the `version` job already declares it for its PR tooling) — without it `gh pr create` 403s.
- **Test Scenarios:**
  - T2.1 Run against a fixture `release-assets/binaries/` tree whose hashes match flake.nix → script exits 0 with no PR.
  - T2.2 Run against a fixture with one different binary → flake.nix hash block changes to the measured SRI and a dry-run mode (env `DRY_RUN=1`) prints the would-be PR rather than pushing.
  - T2.3 `lint-workflows.ts` passes after the `release.yml` edit (actionlint covers the new step's `uses`/`run`/env syntax).
- **Verification:** dry-run against the real repo state must report zero diff (U1 already synced the hashes); `./scripts/tools/lint-workflows.ts` passes.
- **Execution note:** release-time only; never runs on PR branches.

### U3. Hash gate in check-versions.ts

- **Goal:** staleness is visible and blocks CI; the gate recomputes from live bytes, never trusts the `version` field.
- **Requirements:** R2, R5.
- **Files:** `scripts/tools/check-versions.ts`, `scripts/lib/version-files.ts` (add a `checkFlakeHashes` to `checkAllSurfaces`), `.github/workflows/tools.yml` (no change expected — it already runs `check-versions.ts` on every PR and push). Extend the `check-versions.ts` shebang from `--allow-read --allow-env` to `--allow-read --allow-env --allow-net --allow-run=git,gh` — the gate now probes the remote and downloads assets, and Deno rejects those calls without the scopes. Reuse the `gh release download` + SHA-256 recomputation pattern already present in `scripts/tools/verify-release-digests.ts` so the repo keeps one live-asset digest path.
- **Approach:** Extend `checkAllSurfaces` so that, when the tag `v<declared-version>` exists on the remote (`git ls-remote --tags origin` or `gh`), it downloads `comment-checker-<triple>` for each of the four non-Windows triples in `scripts/lib/targets.json` (the same filter as U2) and compares the computed SRI to the flake block. Mismatch fails with the stale triple names. When the tag does not exist yet: exit 0 with a logged skip only when the declared version is newer than the highest existing release tag (the in-flight version-bump case, where assets cannot exist before publish); any other absent-tag state — the declared version is not newer than an existing tag — fails, because the flake URL then points at a tag that will never exist.
- **Test Scenarios:**
  - T3.1 Fixture A: flake.nix with a deliberately wrong SRI + existing tag → command exits non-zero, stderr names the stale triple.
  - T3.2 Fixture B: current true flake.nix + existing v0.3.2 tag → exits 0 (this is the CHK1 fixture: the field present but wrong must fail, present and right must pass).
  - T3.3 Fixture C: declared version newer than every existing release tag with no remote tag → exits 0, logs `skipped: tag vX.Y.Z absent`.
  - T3.4 Fixture D: declared version not newer than an existing release tag but with its own tag missing → exits non-zero, names the absent tag.
- **Verification:** run `./scripts/tools/check-versions.ts` against each fixture (T3.1-T3.4) and record exit codes; run the real repo state (must pass).
- **Execution note:** the tools gate runs on every PR and every push to master (`ci.yml` + `release.yml`), so a failed publish sync blocks everything after it until the sync PR merges.

### U4. Assert `--version` in the binary smoke gate

- **Goal:** a binary that reports the wrong crate version fails the platform gate before any release, on every target triple.
- **Requirements:** R1.
- **Files:** `scripts/tools/run-binary-smoke.ts`, `scripts/lib/version-files.ts` (read `claude-code-comment-checker` crate version from the workspace Cargo.toml), `.github/workflows/platform.yml` (no change expected — smoke already runs in release mode for every matrix row).
- **Approach:** After the existing rc checks, spawn the binary with `--version`, parse the `claude-code-comment-checker <semver>` line, and compare to the crate version from the workspace manifest. On mismatch, exit 1 with both strings. Keep the existing stdin payload checks unchanged.
- **Test Scenarios:**
  - T4.1 A fixture binary that prints `claude-code-comment-checker 0.1.0` while the crate is 0.3.2 → exit 1, stderr names both versions (this is the exact regression that shipped the stale era).
  - T4.2 The real built binary → version matches, gate still reports `binary smoke passed`.
- **Verification:** run the smoke script against the real binary and against a fixture binary with a wrong version line; record exit codes.

## Verification Contract

| Check | Command | Applies to |
|---|---|---|
| One-shot cargo gates (unchanged; classify.rs untouched → no mutants requirement) | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | all units |
| nix acceptance 1+2 | `nix build --no-link --print-out-paths .#comment-checker` then `$out/bin/comment-checker --help` lists `--strip` and `--version` equals `0.3.2` | U1 |
| nix acceptance 3 | decode each flake SRI → hex matches the four live asset digests and differs from the v0.1.5 set | U1, U3 |
| nix acceptance 4 | `printf '%s' '{"tool_input":{"file_path":"x.ts","content":"/** Gate: test */\nconst x=1;\n"}}' \| $out/bin/comment-checker --strip` exits 2 with a findings report | U1 |
| Hash gate | `./scripts/tools/check-versions.ts` — fixtures T3.1-T3.4 and the real repo state | U3 |
| Smoke gate | `./scripts/tools/run-binary-smoke.ts --target x86_64-unknown-linux-gnu --bin-dir <dir>` against real and fixture binaries | U4 |
| Workflow lint | `./scripts/tools/lint-workflows.ts` after the `release.yml` edit | U2 |

## Definition of Done

- U1 done when acceptance 1-4 pass against the nix-built store binary and the stale store path is no longer produced.
- U2 done when the dry run reports zero diff on the synced repo, the workflow lint passes, and the script's PR path is exercised in a fixture (dry-run only — no real push outside the release workflow).
- U3 done when fixtures T3.1 (wrong hash fails), T3.2 (true state passes), T3.3 (newer-version skip), T3.4 (stale-version fail) behave as specified.
- U4 done when fixture T4.1 fails and T4.2 passes.
- Global done: all verification contract rows pass in this session; the change is one PR with a descriptive message; no dead code, no shims, no leftover fixture binaries in the tree; the plan file remains byte-identical to what was written here.