---
title: flake.nix release-asset hashes froze at the v0.1.5 era, so nix builds served the 0.1.0 binary under the 0.3.2 name
date: 2026-08-29
category: integration-issues
module: flake.nix source build (rustPlatform.buildRustPackage) + CI nix gate; version surface (release-version.ts, check-versions.ts)
problem_type: integration_issue
component: distribution
root_cause: config_error
resolution_type: design_change
severity: high
symptoms:
  - "`nix build .#comment-checker` reports store path 0yxkwm3r...-comment-checker-0.3.2 and `--version` prints 0.1.0"
  - "The v0.3.2 GitHub release asset itself is byte-correct; only the flake's declared hash is wrong"
  - "A warm store builds the stale derivation in ~0.35s from cache — the intended 0.3.2 bytes are never fetched"
  - "Issue #81 reported the released binary is 'the 0.1.0 binary'"
tags: [flake, nix, fixed-output-derivation, fetchurl, release-assets, hash-drift, source-build]
---

# Nix FOD hash drift served a stale binary under a current version name

## Problem

`nix build .#comment-checker` produced a binary that reported version 0.1.0 even though the flake declared 0.3.2. The GitHub release assets for v0.3.2 were correct; the `flake.nix` hash block was not. Consumers of `github:systemfsoftware/comment-checker` silently ran a binary from six releases ago that lacked `--strip`.

## Symptoms

- Store path `0yxkwm3r09fdbvr2pnhpbajiw01dp3i4-comment-checker-0.3.2` serves a 6100-byte-larger 0.1.0-era binary.
- The same build on a warm store completes from cache in ~0.35s (fixed-output derivation cache hit) — no network fetch of the published asset.
- Live asset probes are green (`--version` -> 0.3.2, `--help` lists `--strip`, `--strip` exits 2 with findings); only the declared hashes are stale.

## Root cause

A fixed-output derivation (fetchurl) caches by URL basename + declared output hash. The released version appears only in the derivation output name, so bumping the `version =` string never touches which bytes the cache serves. The declared hashes were set once, by hand, and nothing recomputed them against the live release; the release pipeline bumps only the version surface. A smoke gate that asserted exit codes — not the binary's own identity — passed the stale binaries precisely because it never checked what they were.

## Remedy

The flake builds the binary from the repo's own source with `rustPlatform.buildRustPackage`, using the toolchain pinned in `rust-toolchain.toml` via `makeRustPlatform`. The derivation copies `Cargo.toml`, `Cargo.lock`, `crates/`, and `.cargo/` from the current tree (`cleanSourceWith`), so it always carries the current code; `doCheck = false` keeps the crate's tests in CI, not in the derivation.

There is no fetch of the released binary and no binary hash to go stale. The only `fetchurl` left is the tree-sitter-language-pack parser-sources bundle, delivered to the sandboxed build as a hash-pinned dependency (`TSLP_SOURCE_BUNDLE_URL=file://...`): nix verifies that hash, drift fails the build loudly, and the bundle version must track the crate version in Cargo.lock — a dependency pin, not an identity mechanism.

The `version = "0.3.2"` binding stays so the version-sync surface keeps npm, cargo, and the flake in lockstep. CI runs a nix gate that evaluates the flake, builds the `comment-checker-bwrap` derivation, and asserts the built binary's `--version` equals the workspace `Cargo.toml` version.

## Prevention

- Do not hand-pin a released binary's hash in the flake. When the flake's repo is the release source, build from source — there is no hash to sync.
- A smoke gate asserts identity, not just exit codes: the built binary's `--version` must equal the workspace manifest, the single source of truth.
- A gate that guards a distribution surface must build what it guards. Evaluation-only checks (`nix flake check`, `nix eval`) pass a flake whose derivation cannot build.
- Hash-pinned dependency bundles are safe where nix verifies the hash and a mismatch is a hard build error. The failure mode to avoid is an unverified hash that silently serves old bytes.

## Related Issues

- Related: https://github.com/systemfsoftware/comment-checker/issues/81
- docs/solutions/architecture-patterns/rust-cli-npm-distribution.md — release automation and the version-surface discipline.