---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-26
updated: 2026-08-26
type: fix
---

# Ensure all version surfaces stay in sync on changeset release

## Goal Capsule

- **Objective:** A `changeset` release (`scripts/tools/release-version.ts`) bumps every version-bearing surface atomically — `npm/packages/comment-checker/package.json`, `Cargo.toml` `[workspace.package]`, every `crates/*/Cargo.toml`, `flake.nix` (if version-bearing), and any future Claude Code plugin manifest — so `comment-checker --version`, `npm view`, `nix flake show`, and `git tag v*` all report the same version.
- **Product authority:** User-directed — "Ensure that when a changeset release happens the package.json, claude plugin version, rust cargo version, et al are completely in sync".
- **Open blockers:** None. Wiki corpus query for multi-surface version sync returned no settled design (query: `version sync Cargo.toml package.json plugin release-version changeset` with lex/vec/hyde, intent: version synchronization between Rust Cargo, npm package, Claude plugin, and other manifests on changeset release; 2026-08-26; `software-wiki` collection — nil result; top hits were plugin lifecycle axioms A11/A12, unrelated to release automation).
- **Execution profile:** code. Three units: repair residual drift, extend bump script to full surface, harden gate.
- **Stop conditions:** `release-version.ts` writes the same `next` to every surface; `scripts/tools/check-versions.ts` fails on any divergence and is gated in `tools.yml`; `cargo run -- --version`, `jq .version npm/packages/comment-checker/package.json`, `grep version flake.nix`, and (when present) plugin manifest version all agree after a bump.
- **Tail ownership:** LFG after this plan is written.

---

## Product Contract

### Summary

`release-version.ts` was patched (PR #63, commit `1d3bb8b`) to bump `Cargo.toml` + `crates/*/Cargo.toml` alongside the npm launcher. Remaining surfaces are not covered, so `et al` still drifts.

### Problem Frame

Measured 2026-08-26 on `master` (`0969fb5`):

- `Cargo.toml` `[workspace.package] version = "0.1.8"` — synced
- `crates/comment-checker/Cargo.toml` `version = "0.1.8"` — synced
- `npm/packages/comment-checker/package.json` `version = "0.1.8"` — synced
- `package.json` (workspace root, `private: true`) `version = "0.1.0"` — stale, never bumped by any release script
- `flake.nix` `version = "0.1.5"` — stale, never bumped
- `Cargo.lock` entry for `claude-code-comment-checker` is `0.1.7` — derived artifact, updates only after `cargo build`/`cargo update -w` on a branch that has the new manifests
- No Claude Code plugin manifest is tracked (`git ls-files` has no `.claude-plugin/plugin.json`, no `plugin.json`, no `marketplace.json`; only `.claude/settings.json` exists and carries no version field). The user phrase "claude plugin version" therefore either means a future manifest or is already satisfied by the npm launcher version. The plan must handle both: sync any manifest that exists, skip when absent, and make a future manifest impossible to forget.

Release pipeline state machine (`release.yml` → `plan-release.ts` → `release-version.ts` → PR → merge → `platform.yml` build → `tag-released-packages.ts`):

- `plan-release.ts` derives `phase` and `bump` from npm version + pending `.changeset/*.md` — Cargo/nix/root versions are not consulted
- `release-version.ts` currently bumps npm + workspace `Cargo.toml` + `crates/*/Cargo.toml` + `CHANGELOG.md` (post-#63)
- `flake.nix` and root `package.json` are never touched
- `Cargo.lock` is not bumped by the script (correct — it is derived, but the PR should show the lock diff)
- `check-versions.ts` gates `workspace == crates == npm` only

So the next `patch` changeset would bump npm/cargo to `0.1.9` but leave `flake.nix` at `0.1.5` and root at `0.1.0`, re-introducing visible drift.

### Requirements

- R1. After `release-version.ts` computes `next`, every version-bearing manifest that is tracked in git is bumped to `next` in the same commit: `npm/packages/comment-checker/package.json`, `Cargo.toml` `[workspace.package]`, every `crates/*/Cargo.toml` `[package]`, `flake.nix` version string, `package.json` root (if policy says to keep it versioned), and any `*.plugin.json`/`plugin.json`/`marketplace` manifest that carries a version field.
- R2. `comment-checker --version` (via `CARGO_PKG_VERSION`) and `node -p "require('./npm/packages/comment-checker/package.json').version"` and `flake.nix` version report the same `next` after `cargo build`.
- R3. Residual drift is repaired: `flake.nix` `0.1.5` → current npm `0.1.8` (and root `0.1.0` → `0.1.8` if kept versioned); `Cargo.lock` reflects `0.1.8` after the next `cargo build` (no hand-edit of lock).
- R4. Version divergence cannot recur silently — `check-versions.ts` (gated in `tools.yml`) fails non-zero naming every mismatched surface, including `flake.nix` and any plugin manifest present.
- R5. The surface inventory is exhaustive and future-proof: adding a new crate (`crates/*/Cargo.toml`), a second npm workspace, or a plugin manifest does not require a code change to `release-version.ts`/`check-versions.ts` to be caught — glob or manifest-discovery covers it, or the gate fails with "unknown version surface".

### Key Decisions

- KD1. **Bump all text-based manifests in `release-version.ts` alongside npm.** (session-settled: user-directed — chosen over build-time embedding of npm version via `env!`/`VERGEN`: `Cargo.toml` is the source of `clap::command(version)` and the manifest version is canonical; mirroring in the single version-write script is the one place versions change.) Governs R1, R2.
- KD2. **Repair `flake.nix` and root `package.json` drift to `0.1.8` in the same change.** (session-settled: user-directed — chosen over leaving them stale and only fixing forward: the next publish would still ship a mismatched `flake.nix`.) Governs R3.
- KD3. **Keep `Cargo.lock` out of the version script; update via `cargo update -w` in the version commit.** (session-settled: user-approved — chosen over hand-editing `Cargo.lock` or adding `--allow-run` to the Deno script to invoke `cargo`: lock is derived and `cargo update -w` is the canonical updater; hand-edit risks checksum drift.) Governs R3.
- KD4. **Gate via `check-versions.ts` in `tools.yml`; Deno-only, no `cargo` toolchain required.** (session-settled: user-approved — chosen over a Rust test or a new workflow: the check must run on every PR even when Rust cache is skipped.) Governs R4.
- KD5. **Plugin manifest: if no manifest exists, the bump and gate skip it with an explicit "no plugin manifest tracked" log; if one appears, glob discovers it and the gate enforces it.** (session-settled: user-approved — chosen over creating a placeholder manifest: no file is tracked today, so creating one would invent scope; discovery keeps `et al` closed.) Governs R1, R5.

### Acceptance Examples

- AE1. Version bump propagates to every surface
  - **Covers:** R1, R2
  - **Given:** all surfaces at `0.1.8`, one `.changeset/*.md` with `patch`
  - **When:** `release-version.ts` runs
  - **Then:** `npm/packages/comment-checker/package.json` `0.1.9`, both `Cargo.toml` files `0.1.9`, `flake.nix` version `0.1.9`, root `package.json` `0.1.9` (if versioned), `CHANGELOG.md` has `## 0.1.9`, `cargo run -- --version` prints `0.1.9` after `cargo build`
- AE2. Residual drift repaired
  - **Covers:** R3
  - **Given:** current `master` before fix
  - **When:** fix lands
  - **Then:** `flake.nix` version `0.1.8`, root `package.json` `0.1.8` (if kept versioned), `Cargo.toml` and `crates/comment-checker/Cargo.toml` `0.1.8`, `Cargo.lock` entry for the crate is `0.1.8` after `cargo update -w`
- AE3. Gate catches divergence on any surface
  - **Covers:** R4
  - **Given:** `flake.nix` manually edited to `0.1.99` while npm/cargo are `0.1.8`
  - **When:** `deno run --allow-read scripts/tools/check-versions.ts` runs (or `tools.yml` gate)
  - **Then:** non-zero exit, stderr names `flake.nix 0.1.99 != npm 0.1.8` (and names every other mismatch in one run)
- AE4. Future surface is not silently ignored
  - **Covers:** R5
  - **Given:** a new `crates/new-crate/Cargo.toml` at `0.1.0` added on a branch
  - **When:** `check-versions.ts` runs
  - **Then:** fails naming `crates/new-crate/Cargo.toml 0.1.0 != npm 0.1.8`; `release-version.ts` would also bump it via `crates/*/Cargo.toml` glob

### Scope Boundaries

**In scope**

- `scripts/tools/release-version.ts` — extend bump to `flake.nix` and `package.json` (root) and discover plugin manifests
- `scripts/tools/check-versions.ts` — extend gate to `flake.nix`, root, plugin manifests; glob-based
- `Cargo.toml`, `crates/comment-checker/Cargo.toml`, `npm/packages/comment-checker/package.json` — already at `0.1.8` (no edit needed)
- `flake.nix` — `version = "0.1.5"` → `0.1.8`
- `package.json` (root) — `0.1.0` → `0.1.8` (if versioned; otherwise document why it stays `0.1.0` and remove it from the gate)
- `Cargo.lock` — regenerated via `cargo update -w`
- `.github/workflows/tools.yml` — gate already wired; keep Deno-only
- Documentation of `et al` inventory (in plan, not a new doc)

**Deferred**

- Publishing a one-off `v0.1.8` rebuild for the stale `Cargo.lock` that was shipped in the previous tag (lock is not part of the published artifact's version reporting)
- Creating a `.claude-plugin/plugin.json` from scratch (no file tracked; discovery handles future creation)

**Outside identity**

- Classifier logic, hook wiring, npm optionalDependencies pinning (`sync-root-version.ts` — separate concern, injects pins at publish time)
- `publish-surface` verified-artifact changes

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Parse and rewrite `Cargo.toml` as text with narrow `version = "x"` replacement scoped to the correct table header.** Keep the existing `bumpCargoToml` helper; it already handles `[workspace.package]` vs `[package]`. Alternative — `toml` parser dep — adds weight for a two-line edit. Governs `release-version.ts` Cargo bumps. (Carries forward from 2026-08-25-002.)
- KTD2. **Rewrite `flake.nix` `version = "x"` and root `package.json` `version` with the same line-scoped text replacement (Nix) and JSON parse/stringify (root JSON).** Avoid adding a Nix parser; `version = "0.1.x"` occurs once in `flake.nix` at top-level `let version = "..."` or equivalent. Gate: if the line is not found, fail non-zero. For root JSON, use the same `JSON.parse`/`JSON.stringify` pattern as the launcher manifest.
- KTD3. **`Cargo.lock` update is via `cargo update -w` committed alongside the manifest bumps, not via the Deno script.** The script does not need `--allow-run`; the lock diff is produced by running the cargo command in the PR branch before push. This keeps the script's permission set minimal.
- KTD4. **`check-versions.ts` discovers surfaces by glob: `Cargo.toml` `[workspace.package]`, `crates/*/Cargo.toml` `[package]`, `npm/packages/*/package.json`, `flake.nix`, root `package.json` (when not `private`? — decision: if root is `private: true`, still gate its version for consistency unless explicitly excluded with a comment), and `.claude-plugin/plugin.json` plus `**/plugin.json` when present.** Reads each, extracts version (`version = "x"` for TOML/Nix, `JSON.parse(...).version` for JSON), asserts equality with `npm/packages/comment-checker/package.json` as canonical `npmVersion`. Chosen over hard-coded file list: new crates/plugins are caught without code change.
- KTD5. **Root `package.json` policy: either bump it to `next` on every release (private workspace version kept in sync for `et al` completeness) or explicitly declare it `private`-version-exempt with a `// not versioned — workspace root, private` marker and exclude it from the gate.** Prefer bumping — `et al` literally includes `package.json` and `0.1.0` is visibly stale — but if the team decides the root should stay `0.1.0`, the gate must be configured to skip it and the plan must record the exemption so the next agent does not re-introduce it.
- KTD6. **Plugin manifest discovery: check `git ls-files` for `**/plugin.json` + `.claude-plugin/plugin.json`; if none tracked, bump/gate skips with `plugin manifest: none tracked — skipped`.** If a manifest appears, it is treated as authoritative and must match `npmVersion`. This makes `et al` future-proof without inventing a file today.

### Assumptions

- Exactly one `flake.nix` version literal at the top-level `version = "x.y.z"` (current file: line 24 `version = "0.1.5"`). Verified by reading the file.
- Root `package.json` is at repo root, `private: true`, `version = "0.1.0"` (verified 2026-08-26). Decision on whether to keep it versioned is owned by KTD5.
- No other `package.json` under `npm/` beyond `packages/comment-checker` (verified: `git ls-files` has one). If a second appears, the glob in KTD4 covers it.
- `Cargo.lock` format is opaque — only `cargo update -w` mutates it correctly.
- No plugin manifest is tracked today (verified `glob **/.claude-plugin/**` + `git ls-files`).

### Sequencing

U1 (drift repair) and U2 (bump extension) can land in one commit — the drift repair is the same edits the bump extension would make for `next = 0.1.8`. U3 (gate hardening) after, to verify the repaired state. If KTD5 chooses to keep root unversioned, U1 omits the root edit and instead adds the exemption comment.

---

## Implementation Units

### U1. Repair residual drift (flake.nix, root, Cargo.lock)

- **Goal:** Every tracked version surface matches the released `0.1.8` before the next changeset.
- **Requirements:** R3
- **Dependencies:** none
- **Files:**
  - `flake.nix` — `version = "0.1.5"` → `0.1.8`
  - `package.json` — `version "0.1.0"` → `0.1.8` (if KTD5 bumps root) or add exemption marker (if kept)
  - `Cargo.lock` — regenerated via `cargo update -w` (shows `claude-code-comment-checker 0.1.8`); no hand-edit
  - `Cargo.toml`, `crates/comment-checker/Cargo.toml`, `npm/packages/comment-checker/package.json` — already `0.1.8`; verify, no edit needed
- **Approach:** Text replacement for `flake.nix` (`version = "..."`), JSON replacement for root `package.json`. Then `cargo update -w` and commit the lock diff alongside. If root is exempt, document the exemption inline.
- **Test scenarios:** AE2 — `grep -n version flake.nix` shows `0.1.8`; `jq .version package.json` shows `0.1.8` (or exempt); `grep -A2 'name = "claude-code-comment-checker"' Cargo.lock | head` shows `0.1.8`; `cargo run -- --version` prints `0.1.8`.
- **Verification:** `jq .version package.json`; `grep version flake.nix`; `grep -A1 'claude-code-comment-checker' Cargo.lock`; one-shot `cargo test` green.

### U2. Make `release-version.ts` bump every surface atomically

- **Goal:** Future `next` is written to all surfaces in one script run.
- **Requirements:** R1, R2
- **Dependencies:** U1
- **Files:**
  - `scripts/tools/release-version.ts` — after bumping `npm/packages/comment-checker/package.json`, also bump `flake.nix` (`version = "..."`), root `package.json` (JSON), and any `**/plugin.json` discovered via `Deno.readDir`/`glob` that contains a `version` field; keep existing `bumpCargoToml` for Cargo manifests and extend to `crates/*/Cargo.toml` glob (already present)
- **Approach:** After `const next = nextVersion(version, bump)` and npm write, call `bumpCargoToml` for workspace + crates, then `bumpNixVersion('flake.nix', next)` (line-scoped `version = "x"` replace), then `bumpJsonVersion('package.json', next)` (parse/stringify), then discover plugin manifests (`git ls-files` via `Deno.readTextFile` existence check or `Deno.readDir` recursion) and bump those with JSON replacement. Log each bump (`flake.nix → ${next}`, `root package.json → ${next}`, `plugin.json → ${next}`) alongside existing `versioned packages to ${next}`. Fail non-zero if any expected surface has no version literal.
- **Test scenarios:** AE1 — create a temp `.changeset/probe-sync.md` with `patch`, run the script, assert `flake.nix`, root `package.json`, Cargo workspace/crate, npm all bumped to `0.1.9`, plugin discovery logged `none tracked` (or bumps if fixture exists), then `git checkout --` to revert; also test the failure case where `flake.nix` version line is removed → script throws.
- **Verification:** Dry-run against a copy of the manifests or use `git checkout --` revert probe; `cargo test` still green; `deno check scripts/tools/release-version.ts` passes.

### U3. Harden `check-versions.ts` and keep it gated

- **Goal:** Divergence on any surface fails the PR gate with a named message.
- **Requirements:** R4, R5
- **Dependencies:** U1, U2
- **Files:**
  - `scripts/tools/check-versions.ts` — add `extractNixVersion` (`/version\s*=\s*"([^"]+)"/`), `extractJsonVersion`, and discovery for `flake.nix` (`version` literal), root `package.json`, and `**/plugin.json` (glob + existence check); collect mismatches for every surface vs `npm/packages/comment-checker/package.json` canonical; if no plugin manifest, log and skip rather than fail
  - `.github/workflows/tools.yml` — already invokes `check-versions.ts`; no workflow edit needed unless the invocation needs new `--allow-read` paths (it already has `allow-read`)
- **Approach:** Minimal Deno script with `--allow-read`. No extra deps. Wire discovery so a new `crates/*/Cargo.toml` or `npm/packages/*/package.json` or plugin manifest is automatically gated. Keep the existing Cargo extraction helper; add `extractNixVersion` that scans for `version = "x"` outside `[` headers (flake.nix has no TOML headers, so a simple `version = "..."` regex is sufficient but scoped to avoid matching `rust-version`).
- **Test scenarios:** AE3 — temp-edit `flake.nix` to `0.1.99`, run gate, assert non-zero and message `flake.nix 0.1.99 != npm 0.1.8`; revert. AE4 — add a temp `crates/new-crate/Cargo.toml` at `0.1.0`, run gate, assert it names the new crate. Positive case: all aligned → exit 0 with `check-versions: ok ...`.
- **Verification:** `deno run --allow-read scripts/tools/check-versions.ts` green when aligned, red when diverged on each surface; `deno check` green.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | U1, U2, U3 | one-shot gate green |
| 2 | `cargo run -- --version` vs `jq .version npm/packages/comment-checker/package.json` vs `grep -E 'version = \"' flake.nix` vs `jq .version package.json` | U1, U2 | all report same `0.1.8` (or next bump `0.1.9` in probe) |
| 3 | Create `.changeset/probe-sync.md` with `patch`, run `scripts/tools/release-version.ts`, check every surface bumped to `0.1.9`, then `git checkout -- . && git clean -fd .changeset/probe-sync.md` to revert | U2 | `flake.nix`, root `package.json`, Cargo workspace/crate all bumped alongside npm; plugin discovery logged `none tracked` |
| 4 | `deno run --allow-read scripts/tools/check-versions.ts` green; temp-diverge `flake.nix` → red with named mismatch; temp-diverge new crate → red | U3 | gate enforces R4/R5 on every surface |
| 5 | `deno check scripts/tools/release-version.ts scripts/tools/check-versions.ts` | U2, U3 | typecheck green |

---

## Definition of Done

- [ ] U1: `flake.nix` `0.1.8` (and root `package.json` `0.1.8` or explicitly exempted), `Cargo.lock` crate entry `0.1.8`; `comment-checker --version` reports `0.1.8`.
- [ ] U2: `release-version.ts` bumps `flake.nix`, root `package.json`, and any plugin manifest alongside npm/Cargo; probe bump to `0.1.9` proves it.
- [ ] U3: `check-versions.ts` fails on divergence in `flake.nix`, root, or any crate/plugin manifest and passes when aligned; discovery covers future crates/plugins.
- [ ] One-shot gate and `deno check` green; no `*.bak`/`legacy` shims left; inventory of `et al` documented in this plan.

## Risks

- **Nix version literal fragility.** `flake.nix` has `version = "0.1.5"` on line 24 inside `outputs = ... let version = ...` (not TOML). A naive `version =` regex could match `rust-version` or `inputs.nixpkgs.url`. Mitigation: scope to `^\s*version\s*=\s*"` and assert exactly one match; fail if zero or >1.
- **`package.json` root private-version policy.** If the team wants the private root to stay `0.1.0`, blindly bumping it breaks that intent. Mitigation: KTD5 forces an explicit decision and exemption marker; the gate respects the marker.
- **`Cargo.lock` drift.** The lock still references `0.1.7` until `cargo update -w` runs on the bump branch. Mitigation: U1 runs `cargo update -w` and commits the lock; document that lock is derived and `cargo build` would also update it.
- **Plugin manifest invention.** No file exists today; creating a placeholder would invent scope. Mitigation: discovery + skip-with-log (KTD6); the gate fails only when a tracked manifest exists and diverges.
- **New surface regressions.** A future contributor adds `crates/new-crate/Cargo.toml` without knowing about version sync. Mitigation: `check-versions.ts` globs `crates/*/Cargo.toml` and `npm/packages/*/package.json` so the gate catches it with no code change (R5).
