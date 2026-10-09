---
title: A release bump left the crate, Cargo.lock and plugin.json behind once the local version gate was retired
date: 2026-10-09
category: integration-issues
module: release.jsonc version surfaces; version-management sync check; crate version inheritance
problem_type: integration_issue
component: distribution
root_cause: config_error
resolution_type: config_change
severity: high
symptoms:
  - "`version-management bump` on a patch intent rewrote Cargo.toml, flake.nix and both package.json files, but not the crate's own manifest or the plugin manifest"
  - "`version-management sync check` exited 0 with .claude-plugin/plugin.json at 0.3.7 and every declared surface at 0.3.6"
  - "With the crate on `version.workspace = true` and a `toml` surface for Cargo.toml, a bump left Cargo.lock's member entry at the old version, so `cargo metadata --locked` exits 101"
tags: [release-jsonc, version-surfaces, cargo-lock, workspace-version, sync-check, retired-gates]
---

# A release bump left the crate, Cargo.lock and plugin.json behind once the local version gate was retired

## Problem

The retired `check-versions` gate globbed every file that carries the version and compared each one to `package.json`. It was the only thing that held that invariant. The shared toolchain (`pnpm-release-management`, locked in `flake.nix`) bumps and checks only the surfaces `release.jsonc` declares. Two version-bearing files were undeclared: the crate manifest's own `version = "..."` and `.claude-plugin/plugin.json`. Deleting the local gate without declaring them would have shipped a binary whose `--version`, and a plugin whose manifest version, stayed at the previous release.

## Root cause

The version surface list existed twice: once in `release.jsonc` (what the toolchain bumps) and once in the local gate (what CI compared). The two lists had drifted, and only the local gate covered the full set. `sync check` compares declared surfaces only, so an undeclared file never fails it.

The first fix (inherit the workspace version in the crate and keep the `toml` surface kind for `Cargo.toml`) opened a second gap. Once the crate inherits `[workspace.package].version`, `Cargo.lock`'s entry for the member carries the version too. The `toml` kind rewrites the one file it names. A bump left the lock stale, and any `--locked` build or `nix build` against the committed lock fails.

## Solution

Declare every version-bearing file in `release.jsonc` with the surface kind that knows its format, and let the toolchain's `sync check` run in CI:

```jsonc
"surfaces": [
  { "kind": "cargo", "path": "Cargo.toml" },
  { "kind": "json", "path": "npm/packages/comment-checker/package.json" },
  { "kind": "nix", "path": "flake.nix" },
  { "kind": "json", "path": ".claude-plugin/plugin.json" },
],
```

The `cargo` kind (the toolchain's `planCargoBump`) reads and rewrites `[workspace.package].version`, every member that still pins its own `version`, and the members' entries in `Cargo.lock`. `sync check` reports any of the three that differ. The crate takes `version.workspace = true`.

Measured in a scratch copy with the locked toolchain: a `patch` bump moved `Cargo.lock`'s member entry and `plugin.json` with the manifest, `sync check` exited 0 at the new version and `cargo metadata --locked` exited 0. A crate that pins `version = "0.3.7"` again, a stale lock entry, or `plugin.json` at 0.3.7 each make `sync check` exit 1 (`Cargo.toml 0.3.7 != package.json 0.3.6`, `.claude-plugin/plugin.json 0.3.7 != package.json 0.3.6`).

CI's `nix` job also builds the binary from the flake and requires `comment-checker --version` to equal `claude-code-comment-checker <package.json version>` exactly.

## Prevention

Before deleting a repository-local gate in favour of a distributable enforcer, run the replacement against the gate's own inputs and confirm it reads the same set of files. For a version gate, run `version-management bump` on a throwaway intent in a scratch copy and list what changed (`git status --short`); every file the old gate compared must appear. Set the surface `kind` to the file's format (`cargo`, not `toml`, for a Cargo workspace) so files that follow it, such as the lock, move too.
