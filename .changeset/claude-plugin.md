---
'@systemfsoftware/claude-code-comment-checker': minor
---

This repository is also a Claude Code plugin. Enabling it runs a PostToolUse hook that locates `comment-checker` on PATH or via direnv, tells you to run `direnv allow` or `nix develop` when `flake.nix` is why it is missing, and runs a native binary under bwrap when bubblewrap is installed. The hook passes `--strip`.
