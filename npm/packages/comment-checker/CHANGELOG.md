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

## 0.2.0

  - Flagged-comment reports now go to stderr instead of stdout, so the agent that made the edit actually receives them. A blocked verdict previously exited 2 with its report on stdout, which the hook contract discards, so the block arrived carrying no explanation of what was flagged.  If you capture reports yourself, read stderr. Exit codes are unchanged: 0 when nothing is flagged, 2 when something is.

## 0.3.0

  - This repository is also a Claude Code plugin. Enabling it runs a PostToolUse hook that tries `comment-checker --strip`, then `direnv exec`. If both miss and the project has `flake.nix`, the error tells you to run `direnv allow` or `nix develop`.
  - `--strip` deletes whole-line flagged comments from the file named in the hook payload. Without the flag, the hook still only reports. After a strip, the message names a code change to make — rename, extract, or tighten a type — instead of asking you to delete the comment.

## 0.3.1

  - The `PostToolUse` hook is shipped as compiled `run.js` instead of `run.ts`, so it runs on Deno versions that refuse type-stripping inside `node_modules`. Type-checking is preserved through JSDoc annotations and `checkJs` in `hooks/deno.jsonc`.
