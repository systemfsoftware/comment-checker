# comment-checker

[![CI](https://github.com/systemfsoftware/claude-code-comment-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/systemfsoftware/claude-code-comment-checker/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> A Claude Code `PostToolUse` hook that blocks unnecessary code comments with checkable, cited reasons — while sparing earned API documentation, directives, and non-obvious intent.

```bash
pnpm install -g @systemfsoftware/claude-code-comment-checker
```

```
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/load_config.py","content":"import json\n\ndef load_config(path):\n    # Parse the config file\n    data = json.load(open(path))\n    # TODO: fix this later\n    # print(data)\n    return data\n"}}' | comment-checker
An automated reviewer flagged 3 comment(s) in src/load_config.py as unnecessary.

Each is stated with the specific reason it should be removed. Do not
dismiss these as "justified" — the reason is given so the claim can be
checked, not argued away.

  line 4 — # Parse the config file — restates what the code already says (shares config, file, parse)
  line 6 — # TODO: fix this later — a TODO with no tracked reference — file a ticket or delete it
  line 7 — # print(data) — dead code left in a comment

Action: delete the flagged comments. If the code is unclear without
one, make the code self-explanatory instead — better names, extraction,
a clearer type — and do not re-add the comment.
```

---

## Why

Most comment linters rely on blunt allowlists: they flag every comment that lacks a specific annotation, or blindly permit any text placed inside a docstring block. This creates high false-positive noise that trains agents and engineers to dismiss warnings entirely.

`comment-checker` uses tree-sitter AST extraction across 37 programming languages and evaluates comments against prioritized classification rules. When a comment is flagged, the hook provides concrete citations — such as token overlap percentages or verb-to-operator mappings — allowing the agent to verify why a comment failed and fix the underlying code rather than arguing with the tool.

| Capability | Flag-everything linters | comment-checker |
|---|---|---|
| **Classification model** | Blunt allowlist or regex scan | Prioritized rule tables with syntactic AST context |
| **Public API docstrings** | Flagged or blindly permitted | Spared when containing structured contract tags (`@param`, `Args:`, `Returns:`) |
| **Flag feedback** | Generic warning message | Specific, checkable reason citing token overlap and operator evidence |
| **Incremental edits** | Re-evaluates entire source file | Evaluates only newly added comments; skips fragment restatements |
| **Evaluation standard** | Ad-hoc heuristics | F1 ≥ 0.85 on 60-case multi-language benchmark (`eval/corpus.json`) |

---

## Quick Start

### 1. Install the binary

**Recommended (npm / pnpm / yarn / bun):**

```bash
pnpm install -g @systemfsoftware/claude-code-comment-checker
```

The package distributes prebuilt native binaries for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64) via `optionalDependencies`. Package managers install only the single binary target required for your operating system. No postinstall lifecycle scripts run during installation, ensuring full compatibility with `--ignore-scripts`.

<details>
<summary>Other install methods (Cargo, direct binary download)</summary>

**Install via Cargo (requires Rust 1.85+):**

```bash
cargo install --git https://github.com/systemfsoftware/comment-checker --package claude-code-comment-checker
```

**Direct download:**

Prebuilt tarballs (`comment-checker-<target>.tar.gz`) for all supported platforms are attached to every [GitHub Release](https://github.com/systemfsoftware/comment-checker/releases).

</details>

### 2. Configure Claude Code hook

Add `comment-checker` as a `PostToolUse` hook in your user configuration (`~/.claude/settings.json`) or project configuration (`.claude/settings.json`):

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

### 3. Verify execution

When an agent writes code containing justified comments or clean documentation, the tool exits cleanly with status code `0`:

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/client.py","content":"# SPDX-License-Identifier: Apache-2.0\ndef load(path):\n    return open(path).read()\n"}}' | comment-checker
[check-comments] Skipping: No unnecessary comments found
```

---

## What It Flags

`comment-checker` identifies unnecessary comments across five distinct categories:

| Category | Reason cited | Example |
|---|---|---|
| **Restates the code** | `restates what the code already says (<token overlap / operator mapping>)` | `// adds one to one` adjacent to `x += 1` |
| **Narrates control flow** | `narrates the <construct> construct the code already shows` | `// loop over each item` adjacent to `for item in items:` |
| **Change-log memo** | `describes what changed, not why — git history already records this` | `// Changed from old_value to new_value` |
| **Dead code** | `dead code left in a comment` | `// fmt.Println("debug")` |
| **Untracked TODO** | `a TODO with no tracked reference — file a ticket or delete it` | `// TODO: fix this later` |

---

## What It Spares

Comments that provide non-redundant intent or satisfy interface documentation standards are classified as justified and pass without warnings:

- **License & generated headers** — SPDX identifiers, copyright lines, and generated-file notices (`// SPDX-License-Identifier: Apache-2.0`, `/* Copyright (c) 2026 ... */`)
- **Compiler & linter directives** — `# noqa: E501`, `// @ts-ignore`, `// eslint-disable-next-line`, `# shellcheck disable=SC2086`, `// clippy::too_many_arguments`, `/* istanbul ignore next */`
- **BDD test steps** — `# given`, `# when`, `// then`
- **Structured API docstrings & contract tags** — Docstrings containing `@param`, `@returns`, `Args:`, `Returns:`, `# panics`, or `# safety`, as well as leading contract tags on declarations
- **Non-obvious intent & rationale** — Comments explaining *why* something is done (`// workaround: SDK panics on empty input`, `# because SQLite locks during write`, `// to avoid TOCTOU race`, `Why: 1-based index`)
- **Attribution & references** — `// @author Jane Doe`, `// ref: https://...`, `// adapted from ...`
- **Executable shebangs** — `#!/usr/bin/env python3`, `#!/bin/bash`

---

## Supported Languages

Tree-sitter AST parsers are compiled directly into the binary across 37 programming languages and formats:

| Category | Languages |
|---|---|
| **Systems & Native** | Rust (`.rs`), C (`.c`, `.h`), C++ (`.cpp`, `.cc`, `.cxx`, `.hpp`), Zig (`.zig`) |
| **Web & Applications** | TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`), Python (`.py`, `.pyi`), Go (`.go`), Java (`.java`), C# (`.cs`), Kotlin (`.kt`), Scala (`.scala`), Swift (`.swift`), Dart (`.dart`), PHP (`.php`), Ruby (`.rb`), Elixir (`.ex`, `.exs`), Svelte (`.svelte`), Elm (`.elm`), Lua (`.lua`), Groovy (`.groovy`, `.gradle`), OCaml (`.ml`, `.mli`), Haskell (`.hs`), R (`.r`, `.rmd`) |
| **Shell & Config** | Bash / Shell (`.sh`, `.bash`, `.zsh`), SQL (`.sql`), JSON (`.json`), YAML (`.yaml`, `.yml`), TOML (`.toml`), HTML (`.html`), CSS (`.css`), Dockerfile (`Dockerfile`), HCL / Terraform (`.tf`, `.hcl`), CUE (`.cue`), Protocol Buffers (`.proto`), Markdown (`.md`) |

Files written in unsupported extensions or non-code formats are skipped automatically, allowing standard tool execution to proceed without interruptions.

---

## Usage & Configuration

### Custom Prompt Formatting

The `--prompt` command-line option allows teams to override the default notification text delivered to Claude Code. The `{{comments}}` placeholder is replaced with the structured list of flagged comments and citations:

```bash
comment-checker --prompt "Review feedback:\n\n{{comments}}\n\nPlease revise the code."
```

You can configure this flag directly in your `.claude/settings.json` file:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "comment-checker --prompt \"Violations detected:\n\n{{comments}}\""
          }
        ]
      }
    ]
  }
}
```

### Exit Codes

`comment-checker` returns deterministic status codes suitable for shell scripts and automated editor integrations:

| Exit Code | Status | Description |
|---|---|---|
| `0` | **Pass** | No unnecessary comments found, clean payload, or unparseable input (hook never blocks on invalid input) |
| `2` | **Block** | One or more unnecessary comments detected; diagnostic report emitted to stdout |

---

## FAQ

**Q: `command not found: comment-checker` after installation.**
A: Verify that your global package bin directory is included in your shell `PATH` environment variable. For global npm or pnpm installations, you can check active bin paths with `npm bin -g` or `pnpm root -g`.

**Q: Why are comments in `Edit` or `MultiEdit` tool calls treated differently than `Write`?**
A: When Claude Code uses `Edit` or `MultiEdit`, only the newly added comments in the diff are evaluated; pre-existing comments in the file are ignored. Furthermore, since code fragments may lack surrounding AST context, restatement detection is disabled on fragments to prevent false positives.

**Q: Does `comment-checker` modify my source files?**
A: No. `comment-checker` is purely diagnostic. It emits a report to stdout and exits with code 2 to inform the agent of the required correction.

**Q: Does `comment-checker` transmit code over the network?**
A: No. The binary runs entirely locally, processes JSON over stdin, and makes no network requests.

---

## Maintenance & Releases

Releases are triggered by semantic tags pushed to `main` (such as `v0.1.0`), which automatically executes [`.github/workflows/release.yml`](.github/workflows/release.yml). The pipeline compiles release binaries across all matrix targets, validates cryptographic checksums, and publishes each platform package followed by the root launcher with npm OIDC provenance.

Detailed release specifications, matrix bindings, and trusted publisher instructions are documented in [docs/plans/2026-08-17-001-feat-npm-distribution-release-plan.md](docs/plans/2026-08-17-001-feat-npm-distribution-release-plan.md).

---

## Contributing

Development setup, test execution, and mutation testing guidelines are maintained in [AGENTS.md](AGENTS.md).

---

## License

Distributed under the [Apache-2.0 License](LICENSE). © [System F Software](https://github.com/systemfsoftware)
