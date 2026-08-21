# AGENTS.md

A high-quality, mutation-tested Rust implementation of a Claude Code `PostToolUse` hook that classifies code comments as justified or unnecessary. SOTA engineering: 100% mutation on the core classifier, property-based tests, constitution-aligned, with GitHub releases and npm distribution.

The npm distribution layer uses Effect v4 RC (see repos/effect/ for vendored sources). Never install, import, or pin `effect@3.*` in the JS side.

## Directory map

| Path | What it holds |
|------|---------------|
| `crates/` | Rust core (comment-checker crate) |
| `npm/packages/comment-checker/` | JS/npm wrapper (ESM + Effect v4 RC launcher for the Rust binary) |
| `tests/` | Integration / F1 tests |
| `eval/` | Evaluation corpus |
| `repos/effect/` | Vendored Effect v4rc subtree |
| `.github/workflows/` | CI/release (pnpm + cross-platform Rust) |

## Startup Workflow

Before writing code, unconditionally:
1. Confirm the working directory (`pwd`) and the active task (user or task list).
2. Read this file — the whole static surface. No other standing reads.
3. Run the verification commands below and confirm a healthy baseline; repair failures before adding new scope.

No eager-read mandates: document reads are situational, triggered by the work, never by startup:
- `README.md` — when working in a directory you have not worked in before.
- `ARCHITECTURE.md` — when the task changes a module boundary or data flow.
- Product/requirements docs — when a decision depends on product intent.

## Working Rules

- **One task at a time**: finish the active task before starting another.
- **Verification required**: do not claim done without running the verification commands and recording evidence — decisions, bugs, and conventions to the runtime memory system, active work to the task list.
- **Stay in scope**: do not modify files unrelated to the active task; scope reduction requires explicit user approval.
- **Multi-agent**: each agent owns a disjoint file set, claims files before editing, never delegates recursively; the root one-shot verification must pass before any agent claims done.
- **Git discipline**: Master is for releases only and should remain an empty or minimal commit. All work happens on feature branches. Never commit directly to master. Use `git checkout -b feature/...` for new work. Rebase or merge only via PRs.

## Surface Classes

Treat repo files as one of four surfaces; read any, mutate only the assigned class.

| Surface | Examples | Rule |
|---------|----------|------|
| **Locked** | This file, evaluation scripts, merge policy, release workflows | Read and propose changes, never edit to make verification pass. |
| **Editable** | Project code (`crates/`, `tests/`), config, Cargo.toml, npm wrapper | Edit freely within the active task. |
| **Append-only** | `THREAD.md`, experiment logs, rejected ideas, `mutants.out*` artifacts (when tracked) | Append only; never rewrite or delete entries. |
| **Human-controlled** | Main-branch merge, production deploy, credentials, destructive ops, publishing to npm/GitHub under systemfsoftware | Ask the user before acting. |

## Definition of Done

A task is done only when ALL are true:
- [ ] Target behavior is implemented.
- [ ] Required verification actually ran (tests / lint / type-check / build / mutation where applicable).
- [ ] Evidence recorded via the runtime memory system and task list.

## Verification Commands

These are the checks that must pass. The one-shot gate below runs them as phases: an `&&` between two phases is either a real producer→consumer edge or a deliberate fail-fast gate — a cheap check placed first so an expensive phase is never bought on a trivial failure. Steps of comparable cost with no edge between them belong in the same phase, fanned out under one cap.

- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test --all-targets`
- Core classifier mutation (when changing `crates/comment-checker/src/classify.rs`): `cargo mutants --file crates/comment-checker/src/classify.rs --timeout 90`

```bash
# One-shot verification command
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets
```

**For classifier changes**, the mutants command above must be run:
```bash
cargo mutants --file crates/comment-checker/src/classify.rs --timeout 90
```

**Rust/Cargo specifics for manifest resolution**: Commands are direct `cargo` invocations (Cargo.toml serves as manifest; no `[scripts]` like package.json). The gate resolves via the Cargo toolchain present in PATH. The instructions surface names these as the verifiable entrypoints.

Run checks using full system concurrency (`cargo` and `cargo-test` use host CPU defaults).
Add a phase only when the check gating it is far cheaper than the phase behind it; never chain independent same-cost checks with `&&`.
### Anti-Bypass Rules
- Run the full one-shot command, not individual tests in isolation.
- Evidence comes from the current run — never an old CI result or prior session; any failure blocks done, even unrelated-looking ones.
- Never widen the gate's concurrency to make it finish faster; an oversubscribed run is not a passing run.
- Never suppress, skip, or disable checks, or cherry-pick passing tests, to make verification pass.
- Never edit this file or any gate to approve your own work.

### Hallucination Prevention
- **Search before write**: read current source or type definitions before calling a library API; never invent APIs from training memory.
- **Read before edit**: read a file in this session before editing it.
- **Verify before claim**: "done" requires the verification command to have run in this session with output recorded.
- **Cite, do not invent**: every factual claim about the codebase comes from a tool read in this session.

## Human Approval Boundaries

Ask the user before:
- Merging to main/trunk, deploying to production, or releasing.
- Destructive operations (`rm -rf`, dropping databases, deleting migrations).
- Using credentials, tokens, secrets, or destructive tooling.
- Publishing releases or pushing to systemfsoftware org (account/credential mismatch must be resolved first).

## End of Session

1. Record current state, blockers, and next steps via the runtime memory system and task list.
2. Commit with a descriptive message once work is in a safe state.
3. Leave the repo restartable: the next session runs verification immediately.

## Instruction Hierarchy

This root file is the whole harness until evidence proves otherwise, and the whole static surface (root plus pointer, budgeted at 500 lines). Two truths: code and tests are how things ARE; instruction files carry only how we want things to BE — intent and boundaries.

A leaf `AGENTS.md` exists only when it passes the earn test: an agent demonstrably got something wrong in that directory, or it carries a non-derivable mandate no ancestor can carry. A package manifest is NOT evidence; a leaf that describes what a directory contains instead of mandating agent behaviour is a descriptive leaf — delete it. Leaf coverage is evidence-gated, never metric-driven; coverage-count leaves are coverage theater that rots.

Before adding any rule anywhere, run the placement escalation order: (1) delete it, (2) mechanize it — type, lint rule, hook, gate, folder boundary, (3) trigger-load it — skill, (4) situational read when work reaches it, (5) static prose in an instruction file — last resort, for pre-harm universals.

- A rule lives in exactly ONE file: the highest level it applies to. If a rule here applies to exactly one directory, move it to that directory's leaf.
- Leaf delivery is a one-line pointer (`@AGENTS.md`), never a second manual restating this file.
- The directory map stays high-level: directories and their governance only, never individual files — file-level maps go stale and mislead; files are discovered with tools, not declared here.

| Directory | Leaf | Why |
|-----------|------|-----|
| `crates/` | no | Rust core governed by root rules and tests |
| `npm/` | no (governed by root) | npm distribution layer (can contain multiple packages/apps under packages/ or apps/) — simple wrapper today |
| `tests/` | no | test harness governed by root verification |

## Git and Branch Discipline (Project Specific)

- Master branch must remain an empty or minimal commit (only for tags/releases).
- All development happens on feature branches.
- Create feature branches with `git checkout -b feature/<descriptive-name>`.
- Never push directly to master; use PRs for integration.
- Before starting work, ensure you are on the correct feature branch; rebase onto latest master only via approved PR.
- Cleanup commits (e.g., gitignore target/, mutants.out) belong on the feature branch before PR.

Constitution principles (branch-free pure core, mutation-tested classifier, no silent bypasses, evidence before claims) are followed via project tests, gates, and practices. External references are situational only when decisions require them and are not local file dependencies.

## Project-Specific Notes

- Core classifier in `crates/comment-checker/src/classify.rs` must maintain 100% mutation score.
- F1 corpus and threshold in `eval/corpus.json` and `tests/f1.rs`.
- npm wrapper lives under `npm/packages/comment-checker/` (the `npm/` folder is the container that can hold multiple packages/apps). The correct platform binary is provided via optionalDependencies.

## Verification Gate (Staged)

Run as:
```bash
cargo fmt --check && \
cargo clippy --all-targets -- -D warnings && \
cargo test --all-targets
```
Core classifier mutation (when changing `crates/comment-checker/src/classify.rs`): `cargo mutants --file crates/comment-checker/src/classify.rs --timeout 90`
**For classifier changes** add the mutants step above.

**Rust/Cargo specifics for manifest resolution**: Commands are direct `cargo` invocations (Cargo.toml serves as manifest; no `[scripts]` like package.json). The gate resolves via the Cargo toolchain present in PATH. The instructions surface names these as the verifiable entrypoints.

This harness was bootstrapped from the template after subtraction audit (no prior instruction files existed). All rules passed the earn test or escalation order.