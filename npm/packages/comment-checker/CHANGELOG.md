# Changelog

## 0.1.1

  - First automated release with pinned Rust toolchain and async workflow scripts.

## 0.1.2

  - Release v0.1.1 with fixed binary smoke test, multiplatform tarball assets, and automated GitHub release notes.

## 0.1.3

  - Release v0.1.2 with cross-platform release scripts and automated GitHub releases.

## 0.1.4

  - Release v0.1.2 with pinned rust-toolchain, cross-platform scripts, direct shebang execution, and automated GitHub releases.

## 0.1.5

  - Fix Windows artifact upload path and execute full release pipeline.

## 0.1.6

  - Comments introduced by an `Edit` or `MultiEdit` are now judged the same way as comments written by a `Write`. Previously an edit reported only what a comment's own wording revealed — a bare `TODO`, commented-out code, a note about the change just made — so a comment that restated the code beside it or narrated the loop below it was reported on a whole-file write but passed on an edit. Nothing to configure; expect edits to existing files to be flagged more often.

## 0.1.7

  - Fix GitHub releases to include platform binaries for every supported operating system and architecture.

## 0.1.8

  - The `--version` flag now reports the same version as the installed package. Previously it always reported `0.1.0` regardless of which release was installed.
