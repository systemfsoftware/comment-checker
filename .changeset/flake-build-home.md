---
'@systemfsoftware/claude-code-comment-checker': patch
---

The Nix flake build no longer writes to `/homeless-shelter` on machines where Nix runs without a sandbox (the macOS default), so rebuilding the flake or re-entering its direnv shell after an update no longer fails with "home directory /homeless-shelter exists".
