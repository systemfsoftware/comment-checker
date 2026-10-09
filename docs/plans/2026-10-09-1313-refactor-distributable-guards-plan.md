---
title: Retire the repository-local guards
date: 2026-10-09
supersedes: docs/plans/2026-10-09-1203-refactor-distributable-guards-plan.md
topic: distributable-guards
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Retire the Repository-Local Guards - Plan

## Goal Capsule

No `scripts/guards/*` remains, and no script under `scripts/tools/` gates a change. Each invariant a gate held is enforced by something distributable (a Nix flake output this repository already locks), by Cargo's manifest semantics, by a real test of the product, or by GitHub's own mechanism, or it is dropped with a one-line reason. No enforcer decides by a name, word or regex heuristic. Each kept enforcer is seen failing CI on one honest violation, and the final head is green.

## Product Contract

### Requirements

- R1. Deleted: `scripts/guards/`, the gate scripts `check-dep-pins.ts`, `check-matrix.ts`, `check-versions.ts`, `lint-workflows.ts`, `run-binary-smoke.ts`, `verify-platform-metadata.ts`, the `scripts/lib/` modules only they used (`matrix-rows.ts`, `version-files.ts`, `version-sync.ts`), `.husky/` with the `husky` dependency and `prepare` script, and `tools.yml` with its `ci.yml` caller. Edited, not deleted: `js-gate.yml` and `platform.yml` lose only their gate-script steps; `scripts/deno.jsonc` loses the gate tasks and gate-only imports; `scripts/lib/shared.ts` loses the gate-only path constants. No live reference to a deleted name remains. Historical plans under `docs/plans/` are records and stay as written.
- R2. The release tooling stays: `bundle-release-tarball.ts`, `stage-platform-package.ts`, `generate-platform-manifest.ts` and the `scripts/lib/` modules they import (`cli.ts`, `shared.ts`, `platform-manifest.ts`, `write-release-tarball.ts`, `archive-path-for-gnu-tar.ts`, `targets.json`).
- R3. A kept invariant names its enforcer and the CI job that runs it; a dropped invariant names its reason in one line. The pull request body carries the map.
- R4. No enforcer decides by a regex or name match over source text. It reads a declared property (`release.jsonc`, parsed manifests, the workflow AST) or observes the real effect.
- R5. Each kept enforcer that can fail fails CI on one honest violation: pushed violation commits whose CI runs are red on the named step, reverted by the next commit, whose run is green. The branch carries a `none` changeset throughout, so Changeset Check stays out of the evidence.

### Findings that contradict the brief

- F1. The brief names one CI gate in `scripts/tools/` (`check-dep-pins.ts`). CI runs five: `check-dep-pins.ts` and `lint-workflows.ts` (`js-gate.yml`), `check-matrix.ts` (`js-gate.yml`, `platform.yml`, `tools.yml`), `check-versions.ts` (`tools.yml`), and `run-binary-smoke.ts` (`platform.yml`, release mode). A sixth, `verify-platform-metadata.ts`, has no caller.
- F2. `platform.yml`'s `release` mode has no caller; `ci.yml` runs only `rehearsal`. `run-binary-smoke.ts` has therefore never run since npm publishing was dropped. Removing release mode is release tooling and stays out of scope.
- F3. The shared toolchain bumps only the surfaces `release.jsonc` declares: `package.json`, `Cargo.toml` `[workspace.package]`, the launcher manifest and `flake.nix`. It does not bump `crates/comment-checker/Cargo.toml` (its own `version = "0.3.6"` literal) or `.claude-plugin/plugin.json`. The next real release would leave the binary's `--version` and the plugin version at 0.3.6; `check-versions.ts` was the only thing that would have noticed. Measured on `master` with the locked toolchain: `version-management bump` on a `patch` intent rewrites `Cargo.toml`, `flake.nix` and both `package.json` files, and neither the crate manifest nor `plugin.json`. The `toml` surface kind rewrites `Cargo.toml` alone; the toolchain's `cargo` kind also rewrites members that pin their own version and the members' `Cargo.lock` entries, and `sync check` compares all three.
- F4. The toolchain already ships the property `check-versions.ts` re-implemented: `version-management sync check` (in the `release-tools` output of the locked `pnpm-release-management` input) fails when any declared surface differs from the manifest. Measured: with `plugin.json` at 0.3.7 it exits 0 while the file is undeclared, and 1 (`.claude-plugin/plugin.json 0.3.7 != package.json 0.3.6`) once declared.
- F5. The `master` ruleset holds `deletion`, `non_fast_forward` and `pull_request`, and no required status checks. "A branch must contain master" is not held by GitHub today; the pre-push hook was the only holder, and a client-side hook is skipped by `--no-verify`, web edits and clones that never ran `pnpm install`.

### Gate disposition

| Gate | Invariant | Disposition | Enforcer / reason | CI job |
|---|---|---|---|---|
| `check-remote-master.ts` (pre-push) | A pushed branch contains remote `master`; a failed remote query refuses; tags and deletes pass | Dropped | The hook held it only on clients that installed and honoured it (F5); nothing at the repository level does. `pull_request` CI runs on GitHub's merge ref, so what CI tests already contains `master`. Requiring up-to-date branches at merge is a ruleset setting only the operator can turn on | — |
| `check-dep-pins.ts` (lockfile) | The lockfile resolves `@types/node` only at 24.x | Dropped | The declarations are `pnpm-workspace.yaml`'s `overrides` entry `'@types/node': ^24.19.1` (every edge in the graph) and the launcher's own specifier; pnpm resolves the lock from them and `--frozen-lockfile` refuses a lock that disagrees. The check compared the lock to `NODE_TYPES_LTS_MAJOR = 24`, a second copy written inside the checker | — |
| `check-dep-pins.ts` (Dependabot) | The launcher's Dependabot entry ignores `typescript` and `@types/node` semver-major | Dropped | `dependabot.yml` is the declaration and Dependabot reads it; a check that the file contains its own lines is a text match over the declaration. Removing an ignore rule makes Dependabot open the major pull request, which goes through review like any other | — |
| `check-versions.ts` | Every version surface equals the released version | Kept | `version-management sync check` from the locked `pnpm-release-management` `release-tools`. `release.jsonc` declares `Cargo.toml` as a `cargo` surface (workspace version, pinned members, `Cargo.lock`) and `.claude-plugin/plugin.json` as a `json` surface (F3, F4). Residual: a surface removed from `release.jsonc` is no longer compared; that is an edit of the declaration itself | CI `checks` |
| `check-versions.ts` (crate manifest) + `run-binary-smoke.ts` (identity) | The built binary reports the released version | Kept | Cargo: the crate declares `version.workspace = true`, so it has no version of its own. A member that pins its own version again is drift under the `cargo` surface (CI `checks`). Witnessed by the CI `nix` step running the source-built binary: `comment-checker --version` must equal `claude-code-comment-checker <package.json version>` (read with `jq`, replacing the `sed` regex over `Cargo.toml`) | CI `nix`, CI `checks` |
| `run-binary-smoke.ts` (exit contract) | A clean payload exits 0, a flagged payload exits 2 | Kept | `crates/comment-checker/tests/exit_codes.rs` runs the built binary | CI `gate` (`cargo test`) |
| `run-binary-smoke.ts` (per platform) | Each release binary passes the smoke on its own runner | Dropped | Release mode, the only caller, has no caller (F2); the shipped binary is the flake's Linux source build | — |
| `lint-workflows.ts` | Every workflow is valid GitHub Actions, runner labels included | Kept | `actionlint` from the flake's locked `nixpkgs` (`nix shell --inputs-from . nixpkgs#actionlint -c actionlint`) | CI `checks` |
| `lint-workflows.ts` (mode) | Workflow files are world-readable | Dropped | Only the container bind mount of the wrapper needed it; the Nix binary reads the files directly | — |
| `check-matrix.ts` (rows ⊆ table) | Every `platform.yml` row names a `targets.json` target, suffix and bin | Kept | The real effect: `stage-platform-package.ts` exits 1 on an unknown target/suffix pair, and `bundle-release-tarball.ts` fails when the table's bin is not the file the row built | CI `packaging` |
| `check-matrix.ts` (table ⊆ rows) | Every table row has a `platform.yml` row | Dropped | Nothing iterates the table as a whole any more (the one reader, `verify-platform-metadata.ts`, had no caller), so an unbuilt row has no effect | — |
| `check-matrix.ts` (runners) | Table runner equals the workflow runner and is a known label | Dropped | The table's `runner` field has no reader; the workflow's labels are checked by actionlint's runner-label rule (CI `checks`) | — |
| `check-matrix.ts` (suffix set) | The table names exactly linux-x64, linux-arm64, win32-x64 | Dropped | Compared the table to `EXPECTED_SUFFIXES`, a list written in the checker | — |
| `check-matrix.ts` (package shape) | suffix = os-cpu; libc glibc only on Linux; `.exe` iff win32 | Dropped | These shape npm platform packages, which are no longer published or packed (`release.jsonc`: nothing goes to a registry; the release packs workspace members only) | — |
| `check-matrix.ts` (launcher pins) | Launcher `optionalDependencies` equal the platform packages | Dropped | The launcher declares no `optionalDependencies` | — |
| `check-matrix.ts` (caller) | `ci.yml` calls `platform.yml` | Dropped | A text match over a workflow (name heuristic); the `packaging` jobs are visible on every pull request | — |
| `verify-platform-metadata.ts` | Published platform packages carry the table's metadata | Dropped | No caller, and nothing is published to a registry | — |
| `tools.yml` | Shebang tools execute on Windows | Kept | `packaging · win32-x64` runs the shebang tools `stage-platform-package.ts` and `bundle-release-tarball.ts` on `windows-2022`; V1's platform-row violation lands on that row | CI `packaging` |

### Scope boundaries

- Release tooling (`stage-platform-package.ts`, `bundle-release-tarball.ts`, `generate-platform-manifest.ts`, `platform.yml` release mode, `targets.json`'s unused fields) stays.
- No ruleset change (operator-only, F5). `master` requires no status checks, so every kept enforcer is a red CI job, not a merge block; making the jobs required is a ruleset change only the operator can make.
- No pull request to `pnpm-release-management` or `systemfsoftware`: the toolchain already ships the surface check (F4), and actionlint ships in nixpkgs.

## Implementation Units

### U1. Distributable enforcers in CI

- **Files:** `.github/workflows/ci.yml`, `release.jsonc`, `crates/comment-checker/Cargo.toml`, `flake.nix`.
- **Approach:** add a `checks` job (checkout, the pinned nix installer, `nix shell --inputs-from . nixpkgs#actionlint -c actionlint -color`, then `nix shell --inputs-from . pnpm-release-management#release-tools -c version-management sync check` under `if: ${{ !cancelled() }}` so both report). Declare `Cargo.toml` as a `cargo` surface and `.claude-plugin/plugin.json` as a `json` surface. The crate takes `version.workspace = true`. The `nix` job's identity step compares the binary's `--version` line to `claude-code-comment-checker $(jq -r .version package.json)`. The devShell gains `pkgs.actionlint` for local runs.
- **Verify:** `version-management sync check` exits 0; `actionlint` exits 0; `cargo metadata` reports the crate at the workspace version; `Cargo.lock` unchanged; in a scratch copy a `patch` bump moves `Cargo.lock`'s member entry and `plugin.json` with the manifest and `cargo metadata --locked` still exits 0.

### U2. Delete the gates, edit their wiring

- **Delete:** `scripts/guards/`, the six `scripts/tools/` gates, `scripts/lib/{matrix-rows,version-files,version-sync}.ts`, `.github/workflows/tools.yml`, `.husky/`.
- **Edit:** `ci.yml` (drop the `tools` caller), `js-gate.yml` (drop `lint-workflows.ts`, `check-matrix`, `check-dep-pins`; keep frozen install, `pnpm lint`, build, typecheck, `deno task lint`, `deno check`), `platform.yml` (drop the `check-matrix` and `run-binary-smoke.ts` steps; rehearsal and release mode otherwise unchanged), `scripts/lib/shared.ts` (drop `RELEASE_WORKFLOW_PATH`, `CI_WORKFLOW_PATH`, `PLATFORM_WORKFLOW_PATH`, `PNPM_LOCK_PATH`, `DEPENDABOT_PATH`), `scripts/deno.jsonc` and `scripts/deno.lock` (drop the three gate tasks and the imports only gates used; keep `@std/cli`, `@std/path`, `lint`, `manifest:generate`), `package.json` and `pnpm-lock.yaml` (husky), the two `docs/solutions/` docs that cite the deleted gate; add a `none` changeset.
- **Verify:** `git grep` for each deleted name, excluding `docs/plans/`, returns nothing; `deno task lint` and `deno check tools/*.ts` pass; `pnpm install --frozen-lockfile` passes.

## Verification

- Local: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets`; `pnpm lint && pnpm build && pnpm typecheck`; `cd scripts && deno task lint && deno check --config ./deno.jsonc tools/*.ts`; the two Nix commands of U1; the rehearsal scripts on a fixture binary.
- Local negatives, one per kept enforcer that can fail: drift `plugin.json`, the crate pin or the `Cargo.lock` member entry (sync check exits 1); reference an undefined step output in a workflow (actionlint exits 1); give the crate a literal `version` with the lock updated (the binary's `--version` differs from the manifest); unknown suffix to `stage-platform-package.ts` (exit 1).
- CI on the pull request: violation commit V1 (actionlint, crate literal version with `Cargo.lock` updated so the build reaches the identity step and `sync check` reports the pinned member, flagged exit code, win32 platform row suffix) and V2 (`plugin.json` drift) each red on the named step; the revert commit green on every job. No local mutation run.
