# comment-checker

A Claude Code `PostToolUse` hook that flags **genuinely unnecessary** code
comments — and, unlike blunt "flag every comment" checkers, **spares the
justified ones** so the warning is worth listening to.

Built in Rust on tree-sitter (37 grammars, statically linked — no runtime
network, no dynamic loading). A from-scratch, constitution-aligned rewrite of
[`code-yeongyu/go-claude-code-comment-checker`](https://github.com/code-yeongyu/go-claude-code-comment-checker).

## The problem it solves

A checker that flags _every_ comment trains the AI to dismiss the warning
("this one's justified") — even when it isn't. This checker classifies each
comment and only flags the unnecessary ones, with a **specific reason** the
dismissal can't hand-wave:

- `restates what the code already says`
- `a TODO with no tracked reference — file a ticket or delete it`
- `dead code left in a comment`
- `describes what changed, not why — git history already records this`

It **spares** comments that earn their place: license/SPDX headers, linter and
type-checker directives (`# noqa`, `// @ts-ignore`, `eslint-disable`), BDD
steps (`# given/when/then`), public-API docstrings (`@param`/`@returns`/`Args:`),
non-obvious intent (`// workaround:`, `// because`, `// to avoid`), attribution,
shebangs, and generated-file notices.

## Install

### npm

```bash
npm install -g @systemfsoftware/claude-code-comment-checker
```

The package fetches the prebuilt binary for your platform on install.

### GitHub releases

Grab the `comment-checker-<triple>.tar.gz` for your platform from
[releases](https://github.com/systemfsoftware/claude-code-comment-checker/releases)
and put the `comment-checker` binary on your `PATH`.

## Setup

Add to `~/.claude/settings.json` (or `.claude/settings.json` in your project):

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

## Exit codes

| code | meaning                               |
| ---- | ------------------------------------- |
| 0    | pass — no unnecessary comments        |
| 2    | block — unnecessary comments detected |

## Custom prompt

```bash
comment-checker --prompt "Your changes: {{comments}}"
```

## Development

```bash
cargo test --all-targets              # unit + property + composition + F1 gate
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo mutants --file src/classify.rs  # mutation gate (100% on the core)
```

The evaluation corpus (50 labeled code comments) lives in `eval/corpus.json`
and is gated by `tests/f1.rs`; the differential harness (`tests/differential.rs`)
asserts this checker beats the original by ≥ 10 F1 points (measured **1.000 vs
0.710**). A wiki-grounded, position-swapped pairwise judge independently
confirmed the Rust checker is more correct on **18/18 disagreement cases**.

## Constitution conformance

The classifier is a pure, branch-free fold over ordered rule tables (CONST-P1,
CONST-P2) and is gated at a 100% mutation score on the core (CONST-T3). Two
CONST-G1 judgment calls are declared, not hidden: the hook boundary fails open
to a single `None`/empty result rather than tagged error variants (CONST-D2),
because no caller branches on _why_ detection failed — every failure path is
the same deliberate "skip, never block the user"; and `line_number` is an
unbranded `usize` (CONST-D3) because it is only ever read for display, so the
transposition harm the rule exists to prevent cannot occur here.

## How it works

1. The hook receives JSON from Claude Code on stdin.
2. It extracts the content written by `Write`/`Edit`/`MultiEdit`.
3. It detects the language from the file extension and parses it with
   tree-sitter.
4. It walks the tree for comment nodes and classifies each one — the pure core,
   a branch-free fold over ordered rule tables.
5. Justified comments are spared; unnecessary ones are reported with a reason.

## License

MIT.
