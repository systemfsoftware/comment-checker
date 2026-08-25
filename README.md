# comment-checker

[![CI](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Comment-checker is a `PostToolUse` hook for Claude Code that flags unnecessary code comments and states the exact reason each one fails. It is an alternative to flag-everything comment linters that train agents to ignore warnings: a tree-sitter classifier over 37 languages, gated to F1 ≥ 0.85 on a 60-case corpus, that spares public API docs, directives, and non-obvious intent.

It never edits your files, never sends code anywhere, and exits deterministically so the hook can gate automation.

```bash
pnpm add -g @systemfsoftware/claude-code-comment-checker
```

Pipe a `Write` payload to the binary and it reports what it would block:

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/load_config.py","content":"import json\n\ndef load_config(path):\n    # Parse the config file\n    data = json.load(open(path))\n    # TODO: fix this later\n    # print(data)\n    return data\n"}}' | comment-checker
An automated reviewer flagged 3 comment(s) in src/load_config.py as unnecessary.

Each is stated with the specific reason it should be removed. Do not
dismiss these as "justified" — the reason is given so the claim can be
checked, not argued away.

  line 4 — # Parse the config file — restates what the code already says
  line 6 — # TODO: fix this later — a TODO with no tracked reference — file a ticket or delete it
  line 7 — # print(data) — dead code left in a comment

Action: delete the flagged comments. If the code is unclear without
one, make the code self-explanatory instead — better names, extraction,
a clearer type — and do not re-add the comment.
```

Exit status is the contract: `0` on pass, `2` when comments are flagged. The report is written to stderr, because that is the stream a host forwards to the model on exit 2.

## Install

One command, for any npm-compatible manager (npm, pnpm, yarn, bun):

```bash
pnpm add -g @systemfsoftware/claude-code-comment-checker
```

The package publishes one launcher plus per-platform native binaries for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64). The platform package is selected through `os`/`cpu` constraints, and no install hook runs, so `--ignore-scripts` environments work.

| Method | Command | Notes |
|---|---|---|
| npm/pnpm/yarn/bun | `pnpm install -g @systemfsoftware/claude-code-comment-checker` | Primary path; prebuilt binaries |
| Cargo (from source) | `cargo install --git https://github.com/systemfsoftware/comment-checker --package claude-code-comment-checker` | Rust 1.85+; compiles from source |
| Direct download | Tarball per platform from the [Releases page](https://github.com/systemfsoftware/comment-checker/releases) | `comment-checker-<target>.tar.gz` |

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

On `Edit` and `MultiEdit`, only the comments *added* by the edit are checked — pre-existing comments are left alone. Edits also arrive as fragments, so restatement detection is disabled on them to avoid false positives.

### Verify the wiring

Sanity-check with a write that should pass:

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/client.py","content":"# SPDX-License-Identifier: Apache-2.0\ndef load(path):\n    return open(path).read()\n"}}' | comment-checker; echo "exit=$?"
[check-comments] Skipping: No unnecessary comments found
exit=0
```

## Why not a flag-everything linter

Most comment linters use allowlists: flag any comment lacking an annotation, or exempt everything inside a docstring. Both produce noise, and agents learn to dismiss the hook.

| | Flag-everything linters | comment-checker |
|---|---|---|
| Classification | Regex/allowlist | Prioritized rule tables over tree-sitter AST context |
| API docstrings | Flagged or fully exempt | Spared when they carry contract structure (`@param`, `Args:`, `Returns:`) |
| Flag feedback | Generic warning | The specific reason, with token-overlap and verb-to-operator evidence where available |
| Incremental edits | Rechecks whole file | Only the new comments; fragment restatements skipped |
| Evaluation standard | Ad-hoc | F1 ≥ 0.85 enforced on a 60-case, 37-language corpus in CI (`crates/comment-checker/tests/f1.rs` + `eval/corpus.json`) |

## What it flags

Five kinds of unnecessary comment, each with the reason the hook cites:

| Comment kind | Cited reason | Example |
|---|---|---|
| Restates code | `restates what the code already says` (token overlap cited) | `// adds one to one` next to `x += 1` |
| Narrates flow | `narrates the <construct> the code already shows` | `// loop over each item` next to `for item in items:` |
| Change-log memo | `describes what changed, not why` — git already records it | `// Changed from old_value to new_value` |
| Dead code | `dead code left in a comment` | `// fmt.Println("debug")` |
| Untracked TODO | `a TODO with no tracked reference` | `// TODO: fix this later` |

## What it spares

Justified comments pass without warnings:

- **License and generated headers** — SPDX identifiers, copyrights, generated-file notices
- **Directives** — `# noqa: E501`, `// @ts-ignore`, `// eslint-disable-next-line`, `# shellcheck disable=SC2086`, `// clippy::too_many_arguments`
- **BDD steps** — `# given`, `# when`, `// then`
- **Structured API docs** — docstrings with `@param`, `@returns`, `Args:`, `Returns:`, `# panics`, `# safety`
- **Non-obvious intent** — `// workaround: SDK panics on empty input`, `# avoid TOCTOU race`
- **Rationale** — `Why:` notes, attribution (`// @author`), and references (`// ref: https://…`)
- **Shebang lines** — `#!/usr/bin/env python3`

## Supported languages

Tree-sitter parsers are compiled into the binary — 37 languages and formats:

| Family | Languages |
|---|---|
| Systems | Rust, C, C++, Zig |
| Web & apps | TypeScript (`.ts`, `.tsx`), JavaScript, Python, Go, Java, C#, Kotlin, Scala, Swift, PHP, Ruby, Elixir, Svelte, Elm, Lua, Groovy, OCaml, Haskell, R, Dart |
| Shell & config | Bash/Zsh, SQL, JSON, YAML, TOML, HTML, CSS, Dockerfile, HCL/Terraform, CUE, Protocol Buffers, Markdown |

Unsupported files are skipped, so the hook never blocks unrelated work.

## Configuration

### Custom prompt

The default warning text is a single message; replace it with `--prompt` and put the report where it goes:

```bash
comment-checker --prompt "Review feedback:\n\n{{comments}}\n\nRevise the code."
```

```json
{
  "hooks": { "PostToolUse": [ { "matcher": "Write|Edit|MultiEdit", "hooks": [ { "type": "command", "command": "comment-checker --prompt \"Violations detected:\n\n{{comments}}\"" } ] } ] }
}
```

### Exit codes

Deterministic, and the reason sessions and scripts can gate on the hook:

| Code | Meaning |
|---|---|
| 0 | Pass — no unnecessary comments found; empty input or unparseable payload also passes. Skip note on stdout |
| 2 | Block — one or more unnecessary comments; report on stderr, the stream the host forwards to the model |

## FAQ

**Q: `command not found: comment-checker` after installing.**
A: Make sure the package manager's global bin directory is on `PATH`. Check with `pnpm bin -g` (or `npm bin -g`); npm global bins can otherwise land outside the shell path on some setups.

**Q: Does it modify my files?**
A: No. It reads a hook payload over stdin and prints a report; nothing is written to disk.

**Q: Does it send my code anywhere?**
A: No network requests at all. The binary is fully offline.

**Q: It started flagging comments in unrelated files.**
A: It reads the hook payload's file path and skips unsupported formats, but if a `matcher` scope is too wide, restrict it in settings — most setups want `Write|Edit|MultiEdit` only.

## Repository layout

| Path | Contains |
|---|---|
| `crates/comment-checker` | The Rust binary: tree-sitter detection, classification rules, report |
| `npm/packages/comment-checker` | The published npm launcher; its README is the [registry product page](npm/packages/comment-checker/README.md) |
| `tests/` + `eval/corpus.json` | Integration tests and the F1 corpus |
| `.github/workflows/` | CI and the release pipeline (publish with npm OIDC provenance) |

## Contributing

Development setup, verification gates, and the mutation-testing standard live in [AGENTS.md](AGENTS.md).

## License

Apache-2.0. See [LICENSE](LICENSE).