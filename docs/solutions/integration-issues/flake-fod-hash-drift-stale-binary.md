---
title: flake.nix release-asset hashes froze at the v0.1.5 era, so nix builds served the 0.1.0 binary under the 0.3.2 name
date: 2026-08-29
category: integration-issues
module: flake.nix fetchurl hash block + release pipeline (release-version.ts, check-versions.ts)
problem_type: integration_issue
component: distribution
root_cause: config_error
resolution_type: config_change
severity: high
symptoms:
  - "`nix build .#comment-checker` reports store path 0yxkwm3r...-comment-checker-0.3.2 and `--version` prints 0.1.0"
  - "The v0.3.2 GitHub release asset itself is byte-correct; only the flake's declared hash is wrong"
  - "A warm store builds the stale derivation in ~0.35s from cache — the intended 0.3.2 bytes are never fetched"
  - "Issue #81 reported the released binary is 'the 0.1.0 binary'"
tags: [flake, nix, fixed-output-derivation, fetchurl, sri, release-assets, hash-drift, check-versions, effect]
---

# Nix FOD hash drift served a stale binary under a current version name

> This doc records the #81 failure analysis. The fetchurl-based remedy below was
> replaced on 2026-08-30 by the in-flake source build (`rustPlatform.buildRustPackage`),
> which removes the hash block entirely — see "Current remedy" at the end.

## Problem

`nix build .#comment-checker` produced a binary that reported version 0.1.0 even though the flake declared 0.3.2. The GitHub release assets for v0.3.2 were correct; the `flake.nix` `fetchurl` SRI hash block was not. The four hashes were set once in commit `403d2d079` (the v0.1.5 era) and never updated by the release pipeline, which bumps only the `version =` string.

## Symptoms

- Store path `0yxkwm3r09fdbvr2pnhpbajiw01dp3i4-comment-checker-0.3.2` serves a 6100-byte-larger 0.1.0-era binary.
- The same build on a warm store completes from cache in ~0.35s (fixed-output derivation cache hit) — no network fetch of the published asset.
- Live asset probes are green (`--version` -> 0.3.2, `--help` lists `--strip`, `--strip` exits 2 with findings); only the declared hashes are stale.
- Consumers of `github:systemfsoftware/comment-checker` silently ran a binary from six releases ago that lacked `--strip`.

## What Didn't Work

- **Bumping the version string as a sync mechanism.** `release-version.ts` rewrote `version =` everywhere, but Nix fixed-output derivations cache by name + declared hash. The `fetchurl` FOD stores by the URL basename (`comment-checker-<triple>`, no version); the version appears only in the derivation output name. A version bump alone can never invalidate or refresh the cached bytes.
- **Re-uploading or re-releasing.** The correct binary was already published; a new tag would churn the npm/cargo/flake version surface for zero behavioral gain.
- **Relying on the rc-only smoke gate.** `run-binary-smoke.ts` asserted exit codes (clean 0, flagged 2) but never the version string — the 0.1.0-era binaries passed it exactly because it never checked what they were.

## Solution (historical — superseded 2026-08-30)

Four changes on branch gh-81 (pending PR):

1. **Refresh the flake hash block to the live v0.3.2 SRIs** (`flake.nix`): the four `sha256-...` values now equal the bytes at `releases/download/v0.3.2/comment-checker-<triple>` (measured this session from the live assets).
2. **Publish-phase auto-sync** (`scripts/tools/sync-flake-hashes.ts` + `release.yml`): after `create-github-release.ts` extracts the binaries, the step hashes them, rewrites the flake block, round-trip re-reads the file (CHK1), and opens an auto-merged `fix/flake-hashes-v<X>` PR. A retried publish reuses the open PR (edit body) instead of failing on a duplicate create. The publish job gains `pull-requests: write`.
3. **Recomputing gate** (`scripts/lib/version-files.ts` + `check-versions.ts`): for the tag the flake declares, downloads each asset via `gh release download` (2 retries with fail-closed outcome), recomputes the SRI, and fails with `FlakeHashMismatch` naming the stale triple. Absent tags skip only when the declared version is newer than every published release, else `FlakeTagMissing`; an unreachable remote is `FlakeRemoteUnreachable` — never a silent skip. All services (`ChildProcessSpawner`, `Crypto`, `FileSystem`) are Effect services yielded in-effect via `DenoServices.layer`.
4. **Version assertion in the smoke gate** (`scripts/tools/run-binary-smoke.ts`): parses `--version` output and requires it to equal the workspace `Cargo.toml` version, with a strict semver guard.

Shared helpers lived in `scripts/lib/shared.ts`: `sriFromSha256` (SRI encoding) and `unixTargetTriples` (the flake block's four keys, derived from `targets.json` excluding win32). These were removed with the machinery.

## Why This Works (historical)

Nix keys a fixed-output derivation on name + declared output hash. When the declared hash matches the published bytes, the FOD fetches the correct asset; when it doesn't, warm stores replay whatever bytes the stale hash previously certified. The fix made the declared hash *be* the live asset hash (U1), made publishing write the hashes automatically (U2), made CI recompute and compare them from the live release (U3), and made the smoke gate assert the binary's own identity (U4). The gate never trusted `version =` alone — it recomputes from fetched bytes (CHK1 discipline: a self-reported field certifies nothing).

## Current remedy (2026-08-30)

The root fix removes the fetch entirely. `flake.nix` now builds the binary from the repo's own source via `rustPlatform.buildRustPackage` (`doCheck = false`; the crate's tests run in CI, not in the derivation). A source build has no fixed-output derivation and no hash block, so the #81 failure class cannot recur by construction — there is no hash to go stale, and the devshell serves the current tree. The `version` binding remains (the version-sync surface still bumps it), and CI now runs `nix flake check` as the shipped flake-evaluation gate. The fetchurl-era machinery — `sync-flake-hashes.ts`, the release.yml hash-sync step, `checkFlakeHashes`, and the `sriFromSha256`/`unixTargetTriples` helpers — was deleted.

## Prevention

- A fixed-output derivation with a hand-pinned hash is a permanent maintenance liability: the hash is an output of the release, not a constant. Prefer building from source when the flake's own repo is the release source, so there is no hash to sync.
- A smoke gate for a released binary asserts identity, not just exit codes — assert `--version` against a single source of truth (the workspace manifest). This lesson survived the removal: `run-binary-smoke.ts` still asserts the version.
- Any gate that stands in for a real invariant must not skip silently on its own infrastructure failing.

## Related Issues

- Fixes https://github.com/systemfsoftware/comment-checker/issues/81
- docs/solutions/architecture-patterns/rust-cli-npm-distribution.md — release automation and the version-surface discipline this flake hash block participates in.