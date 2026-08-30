# @systemfsoftware/claude-code-comment-checker

A Claude Code `PostToolUse` hook that flags unnecessary code comments and states the exact reason each one fails. A tree-sitter classifier over 37 languages, gated to F1 ≥ 0.85 on a 60-case corpus, it spares public API docs, directives, and non-obvious intent instead of flagging every comment. Without `--strip` it never edits your files, and it never sends code anywhere. It exits deterministically so the hook can gate automation.

## Install

One command, for any npm-compatible manager (npm, pnpm, yarn, bun):

```bash
pnpm add -g @systemfsoftware/claude-code-comment-checker
```

Prebuilt native binaries for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64) are selected through `os`/`cpu` constraints, so `--ignore-scripts` environments work.

| Method | Command |
|---|---|
| npm/pnpm/yarn/bun | `pnpm install -g @systemfsoftware/claude-code-comment-checker` |
| Cargo (from source) | `cargo install --git https://github.com/systemfsoftware/comment-checker --package claude-code-comment-checker` |

## Wire it into Claude Code

Add the hook to user (`~/.claude/settings.json`) or project (`.claude/settings.json`) configuration:

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

The hook's resolution chain is PATH first, then `direnv exec`:

- When `comment-checker` is on PATH, the hook runs it directly. Install globally and the package manager's bin directory must be on PATH (`pnpm bin -g` or `npm bin -g`).
- When the binary is missing on PATH, the hook falls back to `direnv exec "$CLAUDE_PROJECT_DIR"`. Projects with a `flake.nix` that provides the checker (wrapped in bubblewrap) need a `.envrc` containing `use flake` and a one-time `direnv allow`.
- When neither arm resolves, the hook reports that it did not run — nothing was checked. Run the [setup and repair skill](https://github.com/systemfsoftware/comment-checker/blob/master/.claude/skills/comment-checker-setup/SKILL.md) to fix it.

On `Edit` and `MultiEdit`, only the comments *added* by the edit are checked; pre-existing comments are left alone, and restatement detection is disabled on edit fragments to avoid false positives.

## See it in action

Pipe a `Write` payload to the binary. The report goes to stderr, so `2>&1` keeps it when you redirect:

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"demo.ts","content":"// increment counter\nlet counter = 0;\ncounter += 1;\n"}}' | comment-checker 2>&1
An automated reviewer flagged 1 comment(s) in demo.ts as unnecessary.

Each is stated with the specific reason it should be removed. Do not
dismiss these as "justified" — the reason is given so the claim can be
checked, not argued away.

  line 1 — // increment counter — restates what the code already says (shares counter)

Action: delete the flagged comments. If the code is unclear without
one, make the code self-explanatory instead — better names, extraction,
a clearer type — and do not re-add the comment.
```

The exit status is the contract: this write exited `2`. A clean write prints a skip note and exits `0`:

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"demo.ts","content":"// SPDX-License-Identifier: Apache-2.0\nexport const x = 1;\n"}}' | comment-checker 2>&1
[check-comments] Skipping: No unnecessary comments found
```

## What it flags and what it spares

| Comment kind | Cited reason | Example |
|---|---|---|
| Restates code | `restates what the code already says` | `// adds one to one` next to `x += 1` |
| Narrates flow | `narrates the <construct> the code already shows` | `// loop over each item` next to `for item in items:` |
| Change-log memo | `describes what changed, not why` — git already records it | `// Changed from old_value to new_value` |
| Dead code | `dead code left in a comment` | `// console.log("debug")` |
| Untracked TODO | `a TODO with no tracked reference` | `// TODO: fix this later` |

Spared without warning: license and generated headers, directives (`# noqa: E501`, `// @ts-ignore`), BDD steps (`# given`, `// then`), structured API docs (`@param`, `Returns:`), non-obvious intent, `Why:` notes and `// ref:` links, and shebang lines.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Pass — no unnecessary comments found (empty or unparseable payload also passes) |
| `2` | Block — one or more unnecessary comments; the report is on stderr, the stream a host forwards to the model |

## Configuration

Replace the default warning text with `--prompt` and put the report where it goes:

```bash
comment-checker --prompt "Review feedback:\n\n{{comments}}\n\nRevise the code."
```

Delete whole-line flagged comments from the file named in the payload with `--strip`. Trailing and inline comments stay in the file and are still reported:

```bash
comment-checker --strip
```

```json
{
  "hooks": { "PostToolUse": [ { "matcher": "Write|Edit|MultiEdit", "hooks": [ { "type": "command", "command": "comment-checker --strip" } ] } ] }
}
```

## Troubleshooting

**Q: `command not found: comment-checker` after installing.**
A: The package manager's global bin directory is not on PATH. Check with `pnpm bin -g` or `npm bin -g`, then add that directory to PATH.

**Q: The hook reports "comment-checker did not run".**
A: The hook could not resolve the binary on PATH and the `direnv exec` fallback also missed. For a flake-based project, run `direnv allow` once so the `.envrc` loads; otherwise install globally and fix PATH. The [setup and repair skill](https://github.com/systemfsoftware/comment-checker/blob/master/.claude/skills/comment-checker-setup/SKILL.md) ships a doctor (`scripts/doctor.ts`) that probes resolution, identity, the exit-code contract, hook wiring, and the direnv bridge, and prints a fix hint per broken check.

**Q: Does it modify my files?**
A: Not unless you pass `--strip`. The default reads a hook payload over stdin and prints a report.

**Q: Does it send my code anywhere?**
A: No network requests at all. The binary is fully offline.

**Q: It is flagging comments in unrelated files.**
A: It reads the hook payload's file path and skips unsupported formats. If a `matcher` scope is too wide, restrict it in settings — most setups want `Write|Edit|MultiEdit` only.

## Resources

- Full documentation — comments flagged, comments spared, the 37 languages, and version history: [the project README](https://github.com/systemfsoftware/comment-checker/blob/master/README.md)
- Setup and repair: [the comment-checker-setup skill](https://github.com/systemfsoftware/comment-checker/blob/master/.claude/skills/comment-checker-setup/SKILL.md), including its [doctor script](https://github.com/systemfsoftware/comment-checker/blob/master/.claude/skills/comment-checker-setup/scripts/doctor.ts)
- License: [Apache-2.0](https://github.com/systemfsoftware/comment-checker/blob/master/LICENSE)
- Development and contributing: [AGENTS.md](https://github.com/systemfsoftware/comment-checker/blob/master/AGENTS.md)