---
'@systemfsoftware/claude-code-comment-checker': minor
---

This repository is also a Claude Code plugin. Enabling it runs a PostToolUse hook that tries `comment-checker --strip`, then `direnv exec`. If both miss and the project has `flake.nix`, the error tells you to run `direnv allow` or `nix develop`.
