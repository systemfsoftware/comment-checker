# @systemfsoftware/claude-code-comment-checker

A Claude Code `PostToolUse` hook that flags unnecessary code comments and states the exact reason each one fails — an alternative to flag-everything linters, gated to F1 ≥ 0.85 on a 60-case, 37-language corpus. It never edits your files and never sends code anywhere.

## Install

```bash
pnpm add -g @systemfsoftware/claude-code-comment-checker
```

Prebuilt native binaries for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64) are selected through `os`/`cpu` constraints.

## Wire it into Claude Code

Add the hook to `~/.claude/settings.json` (user) or `.claude/settings.json` (project):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "comment-checker" }
        ]
      }
    ]
  }
}
```

On `Edit` and `MultiEdit` only newly added comments are checked; restatement detection is disabled on edit fragments.
On a clean write the hook prints `[check-comments] Skipping: No unnecessary comments found` and exits 0.
When comments are flagged it prints the report with per-comment reasons and exits 2 — the status code is the contract for automation.

## Docs

- Full documentation: comments flagged, comments spared, languages, and `--prompt` configuration — [the project README](https://github.com/systemfsoftware/comment-checker/blob/master/README.md)
- License: [Apache-2.0](https://github.com/systemfsoftware/comment-checker/blob/master/LICENSE)
- Development and contributing: [AGENTS.md](https://github.com/systemfsoftware/comment-checker/blob/master/AGENTS.md)