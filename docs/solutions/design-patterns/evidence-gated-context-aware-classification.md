---
title: Evidence-gated, context-aware comment classification
date: 2026-08-16
category: design-patterns
module: comment-checker (classify.rs)
problem_type: design_pattern
component: service_object
severity: low
applies_when:
  - Building a deterministic classifier whose verdicts must cite the evidence they were built on
  - The classifier's runtime input is a partial view of its subject (hook fragments, diff gates)
  - Structural context (adjacent code) may be missing or unreliable at fragment edges
tags: [classifier, evidence-gated, context-aware, comment-classification, deterministic]
---

# Evidence-gated, context-aware comment classification

## Context

comment-checker is a Claude Code PostToolUse hook that judges whether each
comment in a write earns its place. The classifier core (classify.rs) folds
ordered rule tables (JUSTIFIED then UNNECESSARY), then falls through to two
context-aware detectors — flow narration, then restatement-with-evidence —
and finally a terminal text-only rule. The trap this pattern exists to
prevent: a verdict that rests on context the input cannot vouch for, or
cites "evidence" the code never showed.

## Guidance

1. **Judge the comment against the code it annotates, and cite what you
   actually verified.** Restatement evidence is `RestateEvidence { lexical,
   operator }`: comment tokens found in the adjacent code's token set, plus
   verb→operator table matches (`increment`↔`+=`, `returns`↔`return`,
   `loop`/`iterate`/`retry`→`for`/`while`/`foreach`/`iter`). Evidence is
   returned only when containment ≥ RESTATE_CONTAINMENT (0.5) or an operator
   match fires; otherwise default (no citations), never a guess.
2. **Fragment context is never a conviction.** `reliable_adjacent` is the
   single gate — context marked `unreliable` (Edit/MultiEdit boundary
   fragments) yields no adjacency; the restatement fallback on unreliable
   context is downgraded to `Justified::NonObviousIntent` (fail-open). A
   fragment test (tests/pipeline.rs `multi_edit_new_todo_comment_blocks`)
   keeps the downgrade scoped to the fallback — explicit rules still block.
3. **Mask content that can fake evidence.** String literals are blanked
   before keyword extraction (`mask_literals` → `raw_keyword_tokens`), so
   `print("for the win")` can never be cited as a `for` construct.
4. **Contract markup earns sparing when it leads a declaration position.**
   A docstring is promoted by markup anywhere; a line/block comment is
   promoted only when the markup leads the comment and the comment sits at a
   contract position (above a declaration).
5. **Gate the wiring, not just the score.** The F1 gate runs the production
   parse→detect→classify path and fails when no detected-path restatement
   verdict carries cited evidence — a detector that silently dropped
   `adjacent_code` aliases through otherwise.

### Enforcement (the gates that hold this)

- Mutation: `cargo mutants --file crates/comment-checker/src/classify.rs
  --timeout 90` — 117/117 caught on `feat/sota-comment-adjudication`
  (measured 2026-08-16; branch head not yet merged).
- F1 gate: tests/f1.rs `detected_path_reaches_f1_threshold` (+ evidence
  assertion), `every_case_is_detectable_end_to_end`.
- Per-kind floors: tests/common/mod.rs `per_kind_violations` trips on a
  single-case kind going wrong (`actual == 1 && correct == 0`) and applies
  bucket precision/recall floors at `actual >= MIN_BUCKET`.
- Pipeline pins: tests/pipeline.rs edit-fragment fail-open and block-report
  evidence rendering (`report_cites_restate_evidence`).
- Corpus: eval/corpus.json is the single source of truth — 60 cases, each
  with text/code/position/scope/language/comment_type/kind; malformed JSON
  and zero-case kinds fail loudly.

## Why This Matters

- The hook **blocks the user's write**: an uninhibited conviction costs a
  product telemetry-free, rule-based trust. Every flag is checkable against
  the code, so the reason is the contract.
- Without the fragment rule, an Edit that adds a comment near the cut edge
  gets convicted on code the edit never saw — the single most common
  real-world trigger.
- Without evidence, the floor threshold ("restatement") is unverifiable and
  drifts; with it, the report is the audit trail.

## When to Apply

- Any rule engine whose input is a partial view: LLM hooks seeing only
  written fragments, diff-gated qualifiers, linters classifying without the
  AST.
- The fail-open path costs nothing when you always have complete context
  (whole-file checkers) and fails open there — the pattern's cost is only
  recall on fragments, which is the point (prefer don't-convict).

## Examples

- `// increment the counter` beside `counter += 1` → RestatesCode; report
  cites `shares counter`, `increment ↔ +=`.
- `# throttle to avoid the rate limit` beside `sleep(delay)` → spared
  (NonObviousIntent): shares a surface word but adds a constraint the code
  lacks.
- `# Returns: the user` (Ruby line comment above a def) → PublicApiDoc:
  contract markup leading a non-docstring at contract position.
- Edit fragment adding `# increment the counter` → hook passes (context
  unreliable, downgraded); Edit fragment adding `# TODO: fix` → blocks
  (explicit rule still applies).

## Related

- Plan (design intent, unedited): ../../plans/2026-08-12-002-feat-sota-comment-adjudication-plan.md
- Product doc: ../../../README.md (five kinds; "restatement detection is
  disabled on edits")
- Corpus: ../../../eval/corpus.json