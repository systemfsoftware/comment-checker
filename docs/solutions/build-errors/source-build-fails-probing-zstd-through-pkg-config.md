---
title: The comment-checker package fails to build from source because zstd-sys probes pkg-config
date: 2026-11-13
category: build-errors
module: flake.nix (mkCommentChecker)
problem_type: build_error
component: tooling
severity: high
applies_when:
  - A consumer's flake makes the comment-checker input follow its own nixpkgs
  - The resulting derivation is not in a binary cache, so Nix builds it from source
symptoms:
  - "zstd-sys build.rs panics: Can't probe for zstd in pkg-config ... The pkg-config command could not be found."
  - A consumer's CI or release job fails while building comment-checker, after an unrelated nixpkgs bump
tags:
  - nix
  - rust
  - zstd-sys
  - pkg-config
  - binary-cache
---

# The comment-checker package fails to build from source because zstd-sys probes pkg-config

## Problem

`zstd-sys` is built with its `pkg-config` feature, so its `build.rs` runs `pkg-config --static --libs --cflags libzstd` and panics when the command is missing. `mkCommentChecker`'s `buildRustPackage` declared neither `pkg-config` nor `zstd`.

A cached build hid this. A consumer that sets `inputs.nixpkgs.follows` on comment-checker gets a derivation hash that no cache holds as soon as it moves its own nixpkgs, so Nix builds from source and the build fails. Seen in a consumer's release job after a nixpkgs bump to `f4a03c0`. It also reproduces from this repository with `nix build .#comment-checker --override-input nixpkgs github:NixOS/nixpkgs/f4a03c008967841f2a0b3cb7c436fc6fc31671f6`, where 0.3.7 fails at `zstd-sys-2.1.0+zstd.1.5.7/build.rs:201`.

## Fix

`nativeBuildInputs = [ pkgs.pkg-config ]` and `buildInputs = [ pkgs.zstd ]` on the package. The same override build then succeeds.

## Prevention

A cache hit says nothing about whether a derivation builds. When a crate with a `-sys` build script enters `Cargo.lock`, check its native inputs by building against a nixpkgs revision no cache has seen.
