# comment-checker

[![CI](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> A tree-sitter-based `PostToolUse` hook for Claude Code and coding agents that flags unnecessary comments across 37 programming languages.

## Workspaces & Packages

| Workspace / Package | Description |
|---|---|
| [`npm/packages/comment-checker`](npm/packages/comment-checker/README.md) | Node/npm distribution launcher package (`@systemfsoftware/claude-code-comment-checker`) |
| [`crates/comment-checker`](crates/comment-checker) | Rust core classifier engine, parser rules, and native CLI executable |
| [`.claude/skills/comment-checker-setup`](.claude/skills/comment-checker-setup/SKILL.md) | Harness setup skill and automated diagnostic doctor script |
| [`tests/`](tests) / [`eval/corpus.json`](eval/corpus.json) | 60-case multi-language classification test suite (F1 ≥ 0.85) |
| [`.github/workflows/`](.github/workflows) | Multi-platform build matrix, binary packaging, and npm release pipeline |

## Documentation & Contributing

- **Usage & Hook Setup**: See the [npm launcher README](npm/packages/comment-checker/README.md) for installation, settings configuration, and CLI flags.
- **Diagnostic Tooling**: See the [comment-checker-setup skill](.claude/skills/comment-checker-setup/SKILL.md) for hook verification and troubleshooting.
- **Development & Verification**: See [AGENTS.md](AGENTS.md) for Cargo build gates, code standards, and mutation test instructions.
- **Architecture & Vocabulary**: See [CONCEPTS.md](CONCEPTS.md) for domain terms and classifier verdict mechanics.

## License

[Apache-2.0](LICENSE)
