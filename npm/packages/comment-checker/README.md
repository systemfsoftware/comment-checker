# @systemfsoftware/claude-code-comment-checker

[![npm version](https://img.shields.io/npm/v/@systemfsoftware/claude-code-comment-checker.svg)](https://www.npmjs.com/package/@systemfsoftware/claude-code-comment-checker)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/systemfsoftware/comment-checker/blob/master/LICENSE)

`@systemfsoftware/claude-code-comment-checker` is the npm distribution launcher for `comment-checker`, a standalone `PostToolUse` hook for Claude Code that classifies code comments as justified or unnecessary across 37 programming languages.

It downloads or executes native platform binaries for Linux, macOS, and Windows via optional platform dependencies. Without `--strip`, it never modifies files on disk and performs all parsing and classification offline.

## Quick Start

### 1. Install globally

```bash
pnpm add -g @systemfsoftware/claude-code-comment-checker
```

*Compatible with `npm`, `yarn`, and `bun`.*

### 2. Configure Claude Code

Add the command hook to your project's `.claude/settings.json` or your global `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "comment-checker"
          }
        ]
      }
    ]
  }
}
```

## How It Works

When Claude Code executes a tool call matching `Write`, `Edit`, or `MultiEdit`, the tool input payload is piped to `comment-checker` over `stdin`.

- **On clean code (Pass)**: The process outputs `[check-comments] Skipping: No unnecessary comments found` on `stdout` and exits with status code `0`.
- **On flagged comments (Block)**: The process formats an explanation detailing why each comment was flagged, outputs the diagnostics to `stderr`, and exits with status code `2`. Claude Code passes `stderr` back to the model to prompt remediation.
- **On partial edits**: On `Edit` and `MultiEdit`, only freshly introduced comments are evaluated. Pre-existing comments in surrounding lines are preserved.

## Example Output

Piping a tool payload with unnecessary comments:

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/math.ts","content":"// increment counter\ncounter += 1;\n"}}' | comment-checker 2>&1
An automated reviewer flagged 1 comment(s) in src/math.ts as unnecessary.

Each is stated with the specific reason it should be removed. Do not
dismiss these as "justified" — the reason is given so the claim can be
checked, not argued away.

  line 1 — // increment counter — restates what the code already says (shares counter)

Action: delete the flagged comments. If the code is unclear without
one, make the code self-explanatory instead — better names, extraction,
a clearer type — and do not re-add the comment.
```

## Supported Classifications

| Classification | Rule Description | Example |
|---|---|---|
| **Restatement** | Restates syntax or operations visible in adjacent code | `// increment counter` above `counter += 1;` |
| **Control Flow** | Narrates standard control flow structures | `// loop through items` above `for item in items:` |
| **Changelog Memo** | Explains prior code states that belong in git history | `// Changed from old_api to new_api` |
| **Dead Code** | Commented-out code blocks or debugging statements | `// console.log("debug", value);` |
| **Untracked TODO** | Action items with no ticket or reference issue | `// TODO: fix this later` |

### Allowed Comments

The classifier preserves:
- License headers and SPDX tags (`// SPDX-License-Identifier: Apache-2.0`)
- Linter and compiler directives (`// eslint-disable-next-line`, `# noqa: E501`, `// @ts-ignore`)
- Structured API documentation (`@param`, `@returns`, `Args:`, `Returns:`, `# Safety`)
- Non-obvious intent and architectural rationale (`// Workaround for upstream race in connection pool`)
- BDD test annotations (`// Given`, `// When`, `// Then`)

## Exit Code Contract

| Exit Code | Result | Destination Stream | Description |
|---|---|---|---|
| `0` | Pass | `stdout` | Clean code or unparseable payload (fails open) |
| `2` | Block | `stderr` | Unnecessary comments detected; diagnostics sent to model |

## Options

### Custom Prompt Text (`--prompt`)

Customize the instruction wrapper surrounding the diagnostics:

```bash
comment-checker --prompt "Formatting Guidelines Violation:\n\n{{comments}}\n\nPlease clean up the comments."
```

### Auto-Strip Mode (`--strip`)

Pass `--strip` to delete flagged whole-line comments directly from the target file on disk when invoked:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "comment-checker --strip"
          }
        ]
      }
    ]
  }
}
```

## Troubleshooting

### `command not found: comment-checker`
Ensure your global npm/pnpm/yarn binary directory is included in your system `$PATH`:
- pnpm: `pnpm bin -g`
- npm: `npm bin -g`
- yarn: `yarn global bin`

### Verification via Doctor Tool
For repository setup diagnosis (PATH resolution, direnv fallbacks, binary identity verification), review the [comment-checker-setup skill](https://github.com/systemfsoftware/comment-checker/blob/master/.claude/skills/comment-checker-setup/SKILL.md) and execute its diagnostic script:

```bash
deno run -A https://raw.githubusercontent.com/systemfsoftware/comment-checker/master/.claude/skills/comment-checker-setup/scripts/doctor.ts
```

## Links

- **Repository**: [github.com/systemfsoftware/comment-checker](https://github.com/systemfsoftware/comment-checker)
- **Rust Core & Native Builds**: [GitHub Releases](https://github.com/systemfsoftware/comment-checker/releases)
- **Issues & Support**: [GitHub Issues](https://github.com/systemfsoftware/comment-checker/issues)
- **License**: [Apache-2.0](https://github.com/systemfsoftware/comment-checker/blob/master/LICENSE)
