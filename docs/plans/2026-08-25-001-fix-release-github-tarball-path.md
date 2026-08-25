---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-25
updated: 2026-08-25
type: fix
---

# Fix release GitHub tarball path

Product Contract preservation: new file (`ce-plan-bootstrap`).

## Goal Capsule

- **Objective:** `create-github-release.ts` finds the 5 platform tarballs on `release.yml` publish and creates `v*` GitHub release; `v0.1.6` is not stranded as tag+npm-only.
- **Product authority:** User-directed. Fix the 0/5 failure observed on run 32788225830; no new tests (user: "NO tests tests are copium").
- **Open blockers:** None. Corpus query for release artifact layout returned no settled design (query: `release tarball upload-artifact download-artifact path` with lex/vec/hyde, intent: settled design for release artifact upload/download path handling; 25 Aug 2026; `software-wiki` collection — nil result).
- **Execution profile:** code. Two units: isolate the release artifact upload so its on-disk layout is one file at one path; make the consumer resolve that one path and dump the tree on miss.
- **Stop conditions:** `release.yml` publish step `Download platform artifacts` + `Create GitHub release` would place `release-assets/release-<suffix>/comment-checker-<target>.tar.gz` for all 5 targets; `create-github-release.ts` maps that one path and fails closed with a directory listing if any is absent.
- **Tail ownership:** LFG after this plan is written.

---

## Product Contract

### Summary

Stop guessing artifact paths. The release producer mixes two `dist/` trees, so `upload-artifact` strips `dist/` and the consumer's `dist/`-guess never matches. Upload one file per `release-*` artifact so the consumer has one truth, and prove the miss.

### Problem Frame

`platform.yml` `Upload artifacts` writes artifact `release-<suffix>` with two lines under `dist/` (`scripts/lib/shared.ts` targets `x86_64-unknown-linux-gnu`/`aarch64-unknown-linux-gnu`/`x86_64-apple-darwin`/`aarch64-apple-darwin`/`x86_64-pc-windows-msvc`). `release.yml` `publish` downloads `pattern: release-*` to `release-assets`. Seen on downloaded artifact `release-linux-x64` from run 32788225830: `release-tarball-linux-x64/comment-checker-x86_64-unknown-linux-gnu.tar.gz` plus `staging/platform-linux-x64/binarySha256`. `create-github-release.ts` guesses three paths including `release-assets/release-<suffix>/dist/release-tarball-<suffix>/…` (PR #46's added guess). None matched — all 5 `missing tarball`, exit 1. `gh release view v0.1.6` = not found; npm `0.1.6` and `v0.1.6` tag exist, so the next `master` push will not re-enter publish.

### Requirements

- R1. After `platform.yml` `release` uploads artifact `release-<suffix>`, `download-artifact` with `pattern: release-*` + `path: release-assets` yields a single tarball at `release-assets/release-<suffix>/comment-checker-<target>.tar.gz` for each of the 5 targets in `scripts/lib/targets.json`.
- R2. `create-github-release.ts` resolves that one path per target. On any miss it prints the actual `release-assets/` tree before exiting non-zero, so the next failure names itself.
- R3. `binarySha256` remains available for platform verification (it already ships in `platform-stage-*`; it does not need to ride the `release-*` artifact).
- R4. No new test files, fixtures, or test-only helpers. Verification is file-level (downloaded artifact shape) and the existing Rust gate.

In scope: `platform.yml` `release-*` upload; `create-github-release.ts` lookup + miss diagnostics. Deferred: back-filling the missing `v0.1.6` GitHub release from run 32788225830's live artifacts; `verify-release-digests.ts` stays on its own lane.

### Key Decisions

- KD1. **One file per release artifact over another path guess.** (session-settled: user-directed — chosen over adding a fourth `firstExisting` candidate: a new guess reintroduces CHK1 — a check keyed on its author's path — and keeps the common-parent stripping that broke PR #46.) Governs R1, R2.
- KD2. **No test fixtures — path proof is the downloaded artifact tree.** (session-settled: user-directed — chosen over a `*.test.ts` that `Deno.stat`s the path: user explicitly declined tests as copium and the contract is the CI artifact layout, not a unit stub.) Governs R4.

### Acceptance Examples

- AE1. Post-download single tarball
  - **Covers:** R1, R2
  - **Given:** `release-assets/release-linux-x64/` after downloading `release-*` from a `release` run
  - **When:** the publisher runs
  - **Then:** it finds `release-assets/release-linux-x64/comment-checker-x86_64-unknown-linux-gnu.tar.gz` (no `dist/` or `release-tarball-` prefix) and the same for the other 4 suffixes; missing any one causes a non-zero exit with a `release-assets` listing
- AE2. No extra tarball copy in the staging lane
  - **Covers:** R3
  - **Given:** `platform-stage-*` after the same run
  - **When:** `binarySha256` is needed
  - **Then:** it is still under `release-assets`' staging path or `stages/` from the earlier download, not required from `release-*`

### Scope Boundaries

**In scope**

- `platform.yml` artifact `release-<suffix>` upload path list
- `create-github-release.ts` resolution + error output

**Deferred**

- `verify-release-digests.ts`, `tag-released-packages.ts`, changelog slicing, npm publish order, `ci.yml` packaging rehearsal
- Manual `gh release create v0.1.6` back-fill from the still-live artifacts

**Outside identity**

- Classifier, hook wiring, launcher installation

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Upload only the tarball file for `release-<suffix>`.** Change `platform.yml` `Upload artifacts` `path:` from the two-line `dist/release-tarball-…` + `dist/staging/…/binarySha256` to the single file `dist/release-tarball-${{ matrix.suffix }}/comment-checker-${{ matrix.target }}.tar.gz`. Single file has no common-parent stripping, so `download-artifact` lands it at `release-assets/release-<suffix>/comment-checker-<target>.tar.gz`. Chosen over uploading the directory or mixing files and extending the guess list — one file is the smallest contract.
- KTD2. **Consumer resolves one path, dumps the tree on miss.** Replace `firstExisting([…3 guesses…])` with `release-assets/release-${t.suffix}/comment-checker-${t.target}.tar.gz`. Before exit, walk `release-assets` and print the paths that exist. The dump is the CHK1 fix — recomputation over the actual directory, not another self-reported token.
- KTD3. **No artifact-creation tests.** The check is the artifact listing (AE1) plus `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets`. The `binarySha256` sidecar stays in `platform-stage-*`, already consumed elsewhere.

### Assumptions

- `upload-artifact@v6` single-file path lands as a flat file under the per-artifact dir at `release-assets/release-<suffix>/`. If it instead recreated a prefix, the dump in KTD2 will surface the actual prefix in one failing run and the fix is a one-line prefix tweak, not a new guess list.
- `gh run download … --name release-linux-x64` tree seen locally (`release-tarball-linux-x64/…` + `staging/…`) is the same stripping that `download-artifact` does in `release.yml`.

### Sequencing

U1 then U2 in one branch. U1 changes the producer; U2 changes the consumer that reads what U1 produces in the next release. No publish should run between them except on the fixed branch.

---

## Implementation Units

### U1. Isolate the release tarball artifact

- **Goal:** The `release-*` artifact contains only the tarball, so its download location is one file at one path.
- **Requirements:** R1, R3
- **Dependencies:** none
- **Files:**
  - `.github/workflows/platform.yml` — `Upload artifacts` step `path:` narrowed to the single tarball file
- **Approach:** Remove the `dist/staging/platform-…/binarySha256` line from the `release-*` upload. The staged platform package upload already carries it; `verify-release-digests.ts` reads from `sidecars/` + npm, not from `release-*`.
- **Test scenarios:** (none — KTD3; see Verification Contract)
- **Verification:** Download a `release-*` artifact from the fixed run and list `release-assets/release-<suffix>/`.

### U2. Resolve the one tarball path with a tree dump on miss

- **Goal:** Publisher finds the 5 tarballs or fails with the actual layout.
- **Requirements:** R2
- **Dependencies:** U1
- **Files:**
  - `scripts/tools/create-github-release.ts` — remove `firstExisting` 3-guess list; resolve `release-assets/release-${t.suffix}/comment-checker-${t.target}.tar.gz`; on miss, walk `release-assets` and log the found paths before `Deno.exit(1)`
- **Approach:** Minimal consumer. Keep `TARGETS_PATH` + `MANIFEST` reading and `gh release create` unchanged except the binary list is now the resolved tarballs (still 5). The miss branch is the only new I/O beyond the `stat`.
- **Test scenarios:** (none — KTD3)
- **Verification:** Simulate the published layout locally (`mkdir -p release-assets/release-linux-x64 && touch release-assets/release-linux-x64/comment-checker-x86_64-unknown-linux-gnu.tar.gz` ×5) and run the resolver; remove one file and assert the dump appears.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | U1, U2 | Rust gate green |
| 2 | Artifact shape: `gh run download <fixed-run> --name release-linux-x64` (and peers) lists exactly one `comment-checker-*.tar.gz` at `release-assets/release-<suffix>/` | U1 | No `dist/` or `release-tarball-` prefix under that dir |
| 3 | Miss diagnostics: remove one `release-assets/release-<suffix>/…tar.gz` and run the resolver | U2 | Exit 1 with a `release-assets` tree listing |

No Deno test suite. No mutants.

---

## Definition of Done

- [ ] U1: `release-*` artifact is one tarball file; no mixed `dist/` parent to strip.
- [ ] U2: `create-github-release.ts` resolves `release-assets/release-<suffix>/comment-checker-<target>.tar.gz` and dumps `release-assets/` on any miss.
- [ ] Rust gate (fmt + clippy + test) green on the branch.
- [ ] No new test files, fixtures, or `*.bak`/`legacy` shims left; `git grep -nI -e 'dist/release-tarball' -- scripts/tools/create-github-release.ts` is clean.

## Risks

- **Single-file vs directory prefix surprise.** Mitigation: the miss dump (KTD2) makes the actual prefix visible in one run; the fix is a one-line `join` change, not a new guess list.
- **`v0.1.6` repair gap.** This plan fixes the next publish; the missing `v0.1.6` GitHub release still needs a one-off `gh release create v0.1.6 release-assets/release-*/comment-checker-*.tar.gz` from the live artifacts of run 32788225830.
