# comment-checker

[![CI](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

`comment-checker` is a fast, offline `PostToolUse` hook for Claude Code and coding agents that classifies code comments across 37 languages using tree-sitter. It flags unnecessary restatements, flow narrations, and dead code with exact reasons while sparing justified API docs, directives, and rationale.

```bash
pnpm add -g @systemfsoftware/claude-code-comment-checker
```

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/load_config.py","content":"def load_config(path):\n    # Parse the config file\n    return json.load(open(path))\n"}}' | comment-checker 2>&1
An automated reviewer flagged 1 comment(s) in src/load_config.py as unnecessary.

  line 2 — # Parse the config file — restates what the code already says

Action: delete the flagged comments. If the code is unclear without
one, make the code self-explanatory instead — better names, extraction,
a clearer type — and do not re-add the comment.
```

Exit status is the gate contract: `0` on clean writes, `2` when comments are flagged (diagnostics output to `stderr` for agent recovery).

## Monorepo Layout

This repository contains the native Rust classifier core, the npm multi-platform distribution launcher, integration suites, and setup tooling.

| Workspace / Component | Path | Description |
|---|---|---|
| **npm Launcher** | [`npm/packages/comment-checker`](npm/packages/comment-checker/README.md) | Node/npm distribution launcher package (`@systemfsoftware/claude-code-comment-checker`) |
| **Rust Core** | [`crates/comment-checker`](crates/comment-checker) | Native binary: tree-sitter parsers, rule classification, and report generation |
| **Setup Skill & Doctor** | [`.claude/skills/comment-checker-setup`](.claude/skills/comment-checker-setup/SKILL.md) | Diagnostic doctor script and hook resolution skill for agent harnesses |
| **Test & Eval Corpus** | [`tests/`](tests), [`eval/corpus.json`](eval/corpus.json) | 60-case multi-language classification test suite gated to F1 ≥ 0.85 |
| **CI & Release Workflows** | [`.github/workflows/`](.github/workflows) | Multi-platform compilation matrix and OIDC npm publication pipeline |

## Packages & Usage

- **Installation & Hook Setup**: See the [npm Package README](npm/packages/comment-checker/README.md) for Claude Code hook wiring (`.claude/settings.json`), options (`--prompt`, `--strip`), and troubleshooting.
- **Hook Diagnostics**: Run `./.claude/skills/comment-checker-setup/scripts/doctor.ts` to probe PATH resolution, binary identity, exit contracts, and direnv bridges.

## Development & Gates

- **Contributing & Workflows**: See [AGENTS.md](AGENTS.md) for Rust toolchain setup, Cargo test gates, and 100% classifier mutation testing rules.
- **Architecture & Domain Models**: See [CONCEPTS.md](CONCEPTS.md) for classifier verdict definitions and context semantics.

## License

Apache-2.0. See [LICENSE](LICENSE).
