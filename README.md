# comment-checker

> **comment-checker is a Claude Code hook — an alternative to blunt flag-everything checkers — that blocks only the comments that don't earn their place.**

Every flag names the specific reason — restates the code, TODO without a tracked ticket, dead code left in a comment, change-log memo — so an agent cannot hand-wave it away. Comments that earn their place are spared: license headers, linter and type-checker directives, public-API docs, and non-obvious intent.

```bash
cargo install --git https://github.com/systemfsoftware/comment-checker --package claude-code-comment-checker
```

Wired as a `PostToolUse` hook, it runs on every `Write`, `Edit`, and `MultiEdit`, checks the comments in the written code, and blocks the change when any are unnecessary:

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
exit 2
```

## Install

**Status: pre-release.** The npm distribution is built but the first release has not been published yet. Once it lands, npm is the recommended install:

```bash
pnpm install -g @systemfsoftware/claude-code-comment-checker
```

The package ships prebuilt binaries for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64) as optional dependencies — npm installs only the one for your platform. No postinstall script runs, so `--ignore-scripts` and strict package managers work. Packages are published with OIDC trusted publishing and provenance.

Until then, install from source (works today):

```bash
cargo install --git https://github.com/systemfsoftware/comment-checker --package claude-code-comment-checker
```

Requires Rust 1.85+. Each [GitHub release](https://github.com/systemfsoftware/comment-checker/releases) also attaches `comment-checker-<triple>.tar.gz` tarballs for direct download.

## Quick Start

1. Install (above).
2. Add the hook to `~/.claude/settings.json` (or `.claude/settings.json` in a project):

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

3. Done. A clean change exits 0:

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/client.py","content":"# SPDX-License-Identifier: Apache-2.0\ndef load(path):\n    return open(path).read()\n"}}' | comment-checker
[check-comments] Skipping: No unnecessary comments found
exit 0
```

## What it flags

Five kinds of comments, each with a stated reason:

| Kind | Reason given | Example |
|---|---|---|
| Restates the code | `restates what the code already says` (shares tokens, or an operator match) | `// adds one to one` next to `x := 1 + 1` |
| Narrates the flow | `narrates the for construct the code already shows` | `// loop over each item` next to `for item in items:` |
| Change-log memo | `describes what changed, not why — git history already records this` | `// Changed from old_value to new_value` |
| Dead code in a comment | `dead code left in a comment` | `// fmt.Println("debug")` |
| TODO without a ticket | `a TODO with no tracked reference — file a ticket or delete it` | `// TODO: fix this later` |

Restatement flags cite the evidence: `shares counter; increment ↔ +=` — the 
overlap or verb-to-operator match the verdict was built on, so the reason is 
checkable against the code.

## What it spares

Comments that earn their place are classified as justified and pass:

- **License and provenance** — SPDX identifiers, copyright lines, generated-file notices (`// SPDX-License-Identifier: Apache-2.0`, `// THIS FILE IS AUTO-GENERATED - DO NOT EDIT`)
- **Directives** — `# noqa: E501`, `// @ts-ignore`, `// eslint-disable-next-line`, `# shellcheck disable=SC2086`, `// clippy::too_many_arguments`, `/* istanbul ignore next */`
- **BDD steps** — `# given`, `# when`, `// then`
- **Public-API docs** — docstrings with `@param`, `@returns`, `Args:`, `Returns:`, `# panics`, `# safety`; likewise line/block comments whose text *leads* with a contract tag (`# Returns: …`, `// @param …`) at a contract position (head of a declaration)
- **Non-obvious intent** — `// workaround:`, `# because …`, `// to avoid the TOCTOU race`, `Why:`, `!NOTE:`, `1-based`/`0-based` conventions
- **Attribution and references** — `// @author`, `// ref: https://…`, `adapted from`, `ported from`
- **Shebangs** — `#!/usr/bin/env python`

On `Edit` and `MultiEdit`, only **newly added** comments are checked — pre-existing comments in the file never block a change. The fragment may cut off the surrounding code, so restatement detection is disabled on edits: explicit rules still block, but a comment the hook cannot verify against reliable context passes.

## Why it's different

Blunt comment checkers flag every comment that isn't on a small allowlist — docstrings included. Most flags are false, and the agent learns to dismiss the warning entirely.

| | Flag-everything checkers | comment-checker |
|---|---|---|
| Decision | Flag everything not on an allowlist | Classify each comment against ordered rule tables |
| Docstrings | Flagged | Spared when they document an API |
| Reason per flag | Generic warning | One of five specific, checkable reasons |
| Edits | Whole file | Only newly-added comments; restatement disabled on fragments |
| Precision bar | None | F1 ≥ 0.85 on the context-bearing corpus (60 cases, per-kind floors)

Built in Rust on tree-sitter: 37 languages (Python, TypeScript, JavaScript, Rust, Go, Java, C/C++, C#, Kotlin, Scala, Ruby, PHP, Swift, Elixir, Bash, Lua, SQL, JSON, YAML, TOML, HTML, CSS, Dockerfile, HCL, Markdown, R, Dart, Zig, Haskell, OCaml, Svelte, Elm, Groovy, CUE, Protocol Buffers), statically linked — no runtime network, no dynamic loading. The classifier core is mutation-tested to 100%.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Pass — no unnecessary comments found (also for skipped input: malformed payload, no file path, unsupported language) |
| 2 | Block — unnecessary comments found; the report is printed to stdout |

Malformed input never blocks — a hook must not fail the user's work on bad input.

## Custom prompt

The default report can be replaced; `{{comments}}` inserts it:

```bash
comment-checker --prompt "Your changes contain: {{comments}}"
```

To wire it into the hook command in `settings.json`:

```json
{ "type": "command", "command": "comment-checker --prompt \"Your changes contain: {{comments}}\"" }
```

The default prompt is tuned for precision. Override only with a tested alternative.

## Non-goals

- **No rewriting.** The hook blocks and reports; it does not edit the code or auto-delete comments.
- **Not a linter.** It judges comments only — not style, naming, or architecture.
- **Rule-based, not learned.** A justified comment matching no justification rule can still be flagged, and a noisy one matching a justification pattern can pass. Edge cases belong in the issue tracker.
- **37 languages.** Files in other languages are skipped and exit 0.

## FAQ

**Q: `command not found: comment-checker` after install.**
A: The binary isn't on your shell's PATH. `cargo install` puts it in `~/.cargo/bin`; a global npm install puts it in the npm global bin directory. Restart the shell or add the directory to PATH, then re-check.

**Q: The hook errors with `BinaryNotFound`.**
A: The npm launcher could not find its platform package. This is expected while the npm package is unpublished, or on an unsupported platform (only Linux/macOS x64 + arm64 and Windows x64 exist). Until the first npm release, install with `cargo install --git https://github.com/systemfsoftware/comment-checker --package claude-code-comment-checker`.

**Q: The hook blocked my write. Do I really have to delete the comment?**
A: Only the flagged ones. Each line names the reason, so verify it against the code. If the code is unclear without the comment, make the code self-explanatory — better names, extraction, a clearer type — and don't re-add the comment.

**Q: It flagged a comment that is genuinely useful.**
A: The classifier is rule-based and precision-oriented. Open an issue with the comment and the language; the rule tables are the maintained surface for exactly this feedback.

**Q: It didn't flag a comment I expected it to.**
A: Only the five kinds above are flagged. Also, on `Edit` and `MultiEdit`, only newly-added comments are checked — pre-existing comments pass by design, and restatement detection is disabled because the fragment cannot vouch for the surrounding code.

**Q: Does it send my code anywhere?**
A: No. It is a local binary that reads the hook payload from stdin and writes to stdout — no network, no dynamic loading, no telemetry.

## Contributing

Development setup and workflow: [AGENTS.md](AGENTS.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
