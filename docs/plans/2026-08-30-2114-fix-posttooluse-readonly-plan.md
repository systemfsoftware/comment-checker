---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-30
updated: 2026-08-30
type: fix
title: Make PostToolUse reporting actually work - Plan
---

# Make PostToolUse reporting actually work

## Goal Capsule

- **Objective:** The hook stays a `PostToolUse` hook and runs **read-only**: it never writes files, never passes `--strip`. When a write contains flagged comments it blocks via exit 2 with the report on stderr, and the launcher never crashes or silently skips (the crash made every write look "not fired"; the swallow made real blocks invisible).
- **Means:** Restore plain `comment-checker` (check mode, exit-2 block) on `PostToolUse` in both shipped surfaces, fix the Deno launcher so it cannot crash before the check runs (sensitive-env scrubbing + catch-all), remove the silent `|| exit 0` swallow in `.claude/settings.json`, and pin the wiring in a test (KTD1–KTD3).
- **Product authority:** user-directed — `PostToolUse`, no `--strip`, read-only enforcement.
- **Open blockers:** None.
- **Execution profile:** code. Launcher + wiring + tests + docs + changeset; no classifier or Rust core changes.
- **Stop conditions:** Both registrations are `PostToolUse` and run check mode (no `--strip`); a flagged payload exits 2 with the report on stderr; a blocked write surfaces its report; no `NotCapable` crash on a path with Deno-sensitive env vars present; no `|| exit 0` swallow in the settings hook; one-shot repo gate green.
- **Tail ownership:** `ce-work` after this plan is written (pipeline).

---

## Product Contract

### Summary

The hook is a `PostToolUse` guard for `Write|Edit|MultiEdit` that reports flagged comments and blocks the model's next step with exit 2. It must be read-only: no `--strip`, no file mutation. Two defects made it look broken: the Deno launcher could crash with `NotCapable` before the check ran, and the project-level settings hook swallowed every failure with `|| exit 0`. This plan removes both so every write is actually checked and every block actually surfaces.

### Problem Frame

`PostToolUse` fires after the tool ran; enforcement is reporting + exit 2 (the host feeds the stderr report back and blocks). The shipped plugin hook ran `comment-checker --strip`, which mutates files and fails loudly on read-only paths; a read-only variant must drop the flag entirely. The launcher crashed when an inherited Deno-sensitive env var made the spawn fail at the permission layer. The settings hook swallowed all failures, so even when the checker did run and block, the gate was invisible.

### Requirements

- R1. Both shipped hook surfaces register on `PostToolUse` for `Write|Edit|MultiEdit`.
- R2. The registered commands run the checker in check mode with no `--strip`; the hook never writes files.
- R3. Exit-code contract preserved: `0` pass (skip note on stdout), `2` block (report on stderr), per `tests/exit_codes.rs`.
- R4. When the checker cannot start (missing binary, denied spawn, any other failure), the launcher continues its fallback chain, never throws an uncaught error; if nothing ran, it emits guidance and exits non-zero (never 0).
- R5. The checker's exit code passes through unchanged.
- R6. Docs describe the read-only PostToolUse behavior.
- R7. Release intent recorded in `.changeset/`.

### Scope Boundaries

**In scope:** launcher hardening, wiring (check mode on both surfaces), settings-hook swallow removal, wiring-contract test, docs, changeset.

**Deferred/Out:** `--strip` (removed from the hook path; the CLI flag remains supported for manual use); classifier rules (no change); pre-commit gates.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Stay `PostToolUse`, check mode, read-only.** The user-directed design: report flagged comments and block with exit 2 after the write; never `--strip`, never mutate.
- KTD2. **The launcher never crashes and never silently fails.** Every spawn (direct checker and `direnv exec`) scrubs Deno-sensitive env vars (LD_*/DYLD_*) and passes only PATH+HOME so an inherited variable cannot trigger a `NotCapable` denial; any start error is "binary unavailable" and continues the chain; the final fallback emits guidance and exits non-zero; the checker's 0/2 passes through. The settings-hook command carries the same guarantee without `|| exit 0`.
- KTD3. **The wiring is pinned.** A committed test asserts `PostToolUse` + check mode on both surfaces, no `--strip` in the hook path, and no swallow.

### Assumptions

- A1. `PostToolUse` payloads carry the same `tool_input` fields the binary decodes; check mode needs no file writes.
- A2. The `--strip` CLI flag stays supported for manual use outside the hook.
- A3. No classifier changes.

---

## Implementation Units

### U1. Restore read-only PostToolUse enforcement and harden the launcher

- **Goal:** Both surfaces run plain `comment-checker` on `PostToolUse`; the launcher cannot crash or swallow; blocks surface via exit 2.
- **Requirements:** R1–R5
- **Dependencies:** none
- **Files:** `hooks/run.ts`, `hooks/hooks.json`, `.claude/settings.json`
- **Approach:**
  1. `hooks/run.ts`: run the checker with no `--strip`; scrubbed env (LD_*/DYLD_* removed, PATH+HOME passed) for both the direct and `direnv exec` spawns; catch-all start-error fallback chain; final fallback emits guidance (flake hint) + exits 1; checker exit code passes through.
  2. `hooks/hooks.json`: `PostToolUse`, matcher `Write|Edit|MultiEdit`, command wraps `deno run` with `env -u LD_*…` scrubbing, timeout kept.
  3. `.claude/settings.json`: `PostToolUse`; command runs `comment-checker` (then `direnv`) with no `--strip` and no `|| exit 0` swallow.
- **Patterns:** existing fallback chain shape; `tests/exit_codes.rs` check contract.
- **Test scenarios:**
  - Launcher smoke (crash-class): checker on PATH with a Deno-sensitive env var set → checker runs, no `NotCapable`, exit code passes through.
  - Launcher smoke: checker + direnv absent → guidance + exit 1, no crash.
  - Block smoke: stub checker exiting 2 → launcher exits 2; stub exiting 0 → launcher exits 0.
- **Verification:** `deno check` on `hooks/run.ts`; the smokes behave as stated; both JSONs valid and `PostToolUse`.
- **Execution note:** run the crash-class smoke first — it reproduced the observed `NotCapable` before the fix.

### U2. Pin the wiring contract in a test

- **Goal:** A committed test fails if the hook surfaces drift from `PostToolUse` + check mode or re-introduce `--strip`/a swallow.
- **Requirements:** R1–R3
- **Dependencies:** U1
- **Files:** `crates/comment-checker/tests/wire.rs` (new)
- **Approach:** Read `../../hooks/hooks.json`, `../../.claude/settings.json`, `../../hooks/run.ts` relative to the crate (CARGO_MANIFEST_DIR/../..) and assert: `PostToolUse` with matcher `Write|Edit|MultiEdit` in both; the launcher invokes the checker without `--strip`; no hook command ends in `|| exit 0`.
- **Patterns:** existing black-box tests under `crates/comment-checker/tests/`.
- **Test scenarios:**
  - `hooks/hooks.json` registers `PostToolUse` with the matcher.
  - `.claude/settings.json` registers `PostToolUse` and contains no `--strip` / `|| exit 0`.
  - `hooks/run.ts` invokes the checker without `--strip`.
- **Verification:** `cargo test --all-targets` green.

### U3. Document the read-only behavior

- **Goal:** READMEs and plugin metadata describe the PostToolUse read-only check; no stale `--strip`-in-hook claims.
- **Requirements:** R6
- **Dependencies:** U1
- **Files:** `npm/packages/comment-checker/README.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (only if they claim the hook strips), root `README.md` mentions if any.
- **Approach:** Confirm the wiring examples use plain `comment-checker`; adjust any description that says the hook runs `--strip`; keep `--strip` documented as a manual CLI option.
- **Test expectation:** none — docs/metadata; diff-checked.

### U4. Record release intent

- **Goal:** Reach consumers via the release pipeline.
- **Requirements:** R7
- **Dependencies:** U1–U3 (content settled)
- **Files:** `.changeset/<descriptive-name>.md` (new)
- **Approach:** `patch`; consumer voice; single paragraph — the hook no longer crashes on some environments and no longer needs write access; it reports flagged comments read-only.
- **Test expectation:** none — release metadata; changeset format gate in CI.

---

## Verification Contract

| # | Command | Applies | Done signal |
|---|---|---|---|
| 1 | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | all | one-shot gate green, incl. `tests/wire.rs` |
| 2 | `deno check hooks/run.ts` (via deno.jsonc) | U1 | launcher type-checks |
| 3 | Launcher smokes: crash-class; both-absent → guidance + exit 1; stub exit 2/0 pass-through | U1 | three behaviors run in this session |
| 4 | Flagged `Write` payload → real `comment-checker` (check mode) | U1 | exit 2, report on stderr, file unchanged |

## Definition of Done

- **Global:** R1–R7 hold; one-shot gate green; smokes pass; no dead-end code in the diff; the previous `--strip` wiring experiment is removed, not commented.
- **Per-unit:** U1 launcher hardened + wiring restored and smoked; U2 wire test green; U3 docs consistent; U4 changeset present.