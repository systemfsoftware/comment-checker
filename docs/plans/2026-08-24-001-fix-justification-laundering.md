---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-24
updated: 2026-08-24
type: fix
---

# Justification laundering: a keyword must not acquit a restatement

## Goal Capsule

- **Objective:** Appending or prepending a marker word to a comment that restates its adjacent code must not change the verdict. Today it does, for 13 of 18 paraphrases of one restatement.
- **Product authority:** User-directed. The reported failure is that the hook drives a 10-line comment block down to 2 lines instead of to zero — the surviving lines are the ones carrying a marker word.
- **Open blockers:** None.
- **Execution profile:** code. Characterize, then invert one precedence, then narrow one table, then re-derive the corpus floors.
- **Stop conditions:** The probe fixture's spare-rate is 0 for markers attached to a proven restatement, the F1 gate is green on re-derived labels, and `classify.rs` mutation stays 100%.

---

## Product Contract

### Summary

Conviction in this classifier is evidence-backed and default-deny; acquittal is bare substring membership. That asymmetry is the whole defect. A comment that demonstrably restates its adjacent code is acquitted if it happens to contain `because`, `note:`, `security`, `1-based`, `ref:` or one of 30-odd other common English fragments.

### Problem Frame

Measured against a release build of `master` + the fragment-edge fix, `2026-08-24`, by piping `PostToolUse` payloads to `target/release/comment-checker` and reading the exit code (2 = block, 0 = spare):

- 18 comments, each meaning exactly `set x to 1`, above `const x = 1;`. **13 spared, 5 blocked.** The 5 blocked are the ones carrying no marker.
- Padding is not the escape: `// set x to 1` plus 1, 3, 6, or 9 words of unrelated prose still blocks. Conviction does not depend on the containment ratio clearing a bar, because the catch-all convicts on empty evidence (`classify.rs` terminal rule).
- The escape is therefore entirely the `JUSTIFIED` table, and within it two rules: `is_non_obvious_intent` over `INTENT_MARKERS` (28 substrings incl. `why`, `because`, `must be`, `security`, `algorithm`, `regex`, `1-based`) and `is_attribution` over `ATTRIBUTION_MARKERS` + `ATTRIBUTION_PREFIXES` (incl. `based on`, `credit`, `adapted from`, `ref:`, `source:`).
- `is_bdd` is **not** a hole: `BDD_KEYWORDS.contains(&s)` is exact equality on the stripped text, so `// when the flag is on` blocks. `DIRECTIVE_PREFIXES` is **not** a hole: it carries only tool-specific tokens, so `// Allows the caller to…` blocks. Both were checked and both hold.
- Unsupported extensions pass unenforced (`// set x to 1` in `a.foo` spares). Known, by design, out of scope here.

`JUSTIFIED` is consulted before `UNNECESSARY` and before the context-aware detectors (`classify.rs` `classify`), so a marker word wins before any evidence is computed. The precedence, not the table contents, is what makes the tool launderable.

### Requirements

- R1. A comment whose restatement of its adjacent code is provable with cited evidence is convicted, regardless of any marker it contains.
- R2. A marker that is a doc-tool tag (`@author`, `@copyright`, `@see`, `@link`) justifies only in lead position; prose provenance phrases (`based on`, `credit`, `adapted from`, `ported from`) do not justify at all.
- R3. A comment that carries a genuine non-obvious why and does not restate its adjacent code stays justified. `// why a clone: the SDK mutates the original in place` above `const buf = orig.slice();` passes today and must still pass.
- R4. The before-state and after-state are both re-derivable in-repo by one command, not by a transcript.
- R5. A `RestatesCode` conviction whose evidence cites nothing does not claim the comment restates the code. Measured: `// SAFETY: the SDK mutates this buffer in place, so a clone is required.` above `const buf = orig.slice();` is convicted with reason `restates what the code already says` and an empty citation, which is the reason string asserting a comparison the classifier never made.

### Key Decisions

- KD1. **Invert the precedence; do not delete the tables.** A why-comment is legitimate doctrine and the settled position is that the cap belongs on comment *content*, not on comment *length* or on the presence of a vocabulary. Deleting `NonObviousIntent` would cost the class the rule exists to protect (R3). Governs R1, R3.
- KD2. **Proven restatement is the only thing that outranks a marker.** Not the terminal empty-evidence rule. An unproven conviction must not be able to override a justification, or the change becomes "block everything" wearing a precedence patch. Governs R1.
- KD3. **The corpus is the specification.** Labels are re-derived and the per-kind floors re-run before the change is trusted; the F1 number after the change measures the new doctrine only if the labels moved with it. Governs R4.

### Acceptance Examples

- AE1. Marker on a proven restatement
  - **Covers:** R1
  - **Given:** `// set x to 1 because` above `const x = 1;`
  - **When:** the hook runs
  - **Then:** exit 2, and the reason cites the shared tokens
- AE2. Marker on a non-restatement
  - **Covers:** R3
  - **Given:** `// why a clone: the SDK mutates the original in place` above `const buf = orig.slice();`
  - **When:** the hook runs
  - **Then:** exit 0 — this passes today and must still pass after U2
- AE4. Uncited conviction
  - **Covers:** R5
  - **Given:** `// SAFETY: the SDK mutates this buffer in place, so a clone is required.` above `const buf = orig.slice();`
  - **When:** the hook runs
  - **Then:** exit 2 today, with reason `restates what the code already says` and no cited tokens. Target: not convicted on that reason.
- AE3. Prose provenance
  - **Covers:** R2
  - **Given:** `// based on old code, sets x to 1` above `const x = 1;`
  - **When:** the hook runs
  - **Then:** exit 2

### Scope Boundaries

**In scope**

- `classify` precedence between `JUSTIFIED` and proven restatement
- `ATTRIBUTION_MARKERS` / `ATTRIBUTION_PREFIXES` narrowing
- corpus labels and per-kind floors for the affected kinds
- a re-runnable laundering probe fixture

**Deferred**

- Unsupported-extension coverage (a comment in `a.foo` is never seen)
- `INTENT_MARKERS` membership itself — precedence is the fix; trimming the list is a separate question the corpus should answer

**Outside identity**

- The npm launcher, release workflows, detector/tree-sitter layer

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Compute proven restatement before consulting `JUSTIFIED`, and let only a cited-evidence verdict pre-empt it.** `RestateEvidence::is_empty()` already distinguishes a cited claim from the terminal text-only path, so the pre-emption predicate exists and needs no new concept. `NarratesControlFlow` cites both verb and construct and pre-empts on the same footing.
- KTD2. **Keep the unreliable-context refusal intact.** On an `Edit`/`MultiEdit` fragment edge there is no adjacent code to prove anything against, so no pre-emption can fire there and the conservative fallback stands. This is why the fragment-edge fix lands first.
- KTD3. **Probe fixture is a test, not a script.** The 18-case laundering set becomes a table-driven test asserting a spare-count of 0 for the restatement rows, so the number in this plan cannot rot silently.

### Assumptions

- The five currently-blocked rows block for the restatement reason, not incidentally. Verified per-row by reading the cited reason, not the exit code alone.
- Corpus cases labelled `NonObviousIntent` mostly do not overlap their adjacent code; if many do, U4 grows and KD1 gets re-examined rather than forced.

### Sequencing

U0 has landed. U1 before U2 — the before-state must be pinned before the precedence moves. U3 after U2 so one behaviour change is measured at a time. U4 gates the claim, not the code. U5 last: it changes a reason string, and re-labelling in U4 must not be done against a label U5 is about to rename.

---

## Implementation Units

### U0. Fragment-edge unreliability (landed)

- **Goal:** `Edit`/`MultiEdit` stops acquitting every added comment.
- **Requirements:** prerequisite for R1 on the edit path
- **Files:** `crates/comment-checker/src/check.rs`, `crates/comment-checker/tests/pipeline.rs`
- **Approach:** Mark context unreliable only where the fragment boundary could have removed the adjacent code: no adjacent code, or nothing after the comment. Restores the edge-scoped rule the adjudication plan specifies.
- **Verification:** `cargo test --all-targets` — 15 pipeline tests, F1 unchanged. Done.

### U1. Laundering probe fixture

- **Goal:** The before-state is a test, not a claim.
- **Requirements:** R4
- **Dependencies:** U0
- **Files:**
  - `crates/comment-checker/tests/laundering.rs` — create
- **Approach:** Table of (comment, adjacent code, expected outcome) over the 18 rows, driven through `check` at the same seam `pipeline.rs` uses. Land it asserting the **current** outcomes, so U2's diff is the behaviour change and nothing else.
- **Verification:** `cargo test --test laundering` green before U2, and the row expectations flip in U2's diff.

### U2. Proven restatement outranks a marker

- **Goal:** A marker cannot acquit a comment whose restatement is proven.
- **Requirements:** R1, R3
- **Dependencies:** U1
- **Files:**
  - `crates/comment-checker/src/classify.rs` — `classify` precedence
- **Approach:** Compute the context-aware verdict first when the context is reliable. If it is `NarratesControlFlow`, or `RestatesCode` whose evidence is non-empty, return it. Otherwise fall through to the existing `JUSTIFIED` → `UNNECESSARY` → terminal order unchanged. The unreliable path is untouched (KTD2).
- **Test scenarios:**
  - AE1 blocks and the report cites shared tokens.
  - AE2 passes.
  - A linter directive on a restating line still passes — directives are machine-read and must not be convicted.
  - A shebang and an SPDX header still pass.
- **Verification:** `cargo test --all-targets`, then `cargo mutants --file crates/comment-checker/src/classify.rs --timeout 90` at 100%.

### U3. Narrow attribution to lead-position tags

- **Goal:** Provenance prose stops acquitting.
- **Requirements:** R2
- **Dependencies:** U2
- **Files:**
  - `crates/comment-checker/src/classify.rs` — `ATTRIBUTION_MARKERS`, `is_attribution`
- **Approach:** Keep `@author`, `@copyright`, `@see`, `@link` and require lead position, reusing the existing lead-strip helper. Drop `adapted from`, `based on`, `ported from`, `credit`. `@copyright` file headers remain justified through the license rule.
- **Test scenarios:** AE3 blocks; `// @see other-module` in lead position passes; `// see the other module` blocks.
- **Verification:** as U2, plus the F1 gate.

### U4. Re-derive corpus labels and floors

- **Goal:** The F1 number measures the new doctrine.
- **Requirements:** R4, KD3
- **Dependencies:** U2, U3
- **Files:**
  - `eval/corpus.json` — re-adjudicate cases whose kind is `NonObviousIntent` or `Attribution`
  - `crates/comment-checker/tests/f1.rs` — floors if a kind's bucket moved
- **Approach:** For each affected case, decide the label under the stated doctrine — does the comment restate its authored adjacent code? Record the count moved. Re-run the per-kind precision and recall floors; a kind that drops below its floor is a finding about the doctrine, not a number to lower.
- **Verification:** `cargo test --test f1` green with floors unchanged, or a written argument for any floor that moves.

### U5. Stop claiming restatement without a citation

- **Goal:** A conviction's reason names what the classifier actually found.
- **Requirements:** R5
- **Dependencies:** U4
- **Files:**
  - `crates/comment-checker/src/comment.rs` — a terminal kind distinct from `RestatesCode`
  - `crates/comment-checker/src/classify.rs` — terminal path returns it
  - `crates/comment-checker/src/report.rs` — its reason string
- **Approach:** The terminal text-only path keeps convicting — default-deny is the forcing behaviour and is not in question. It stops borrowing the `RestatesCode` label it cannot evidence, and reports the reason it can stand behind: the comment carries prose with no counterpart in the adjacent code. Verdict unchanged, claim honest. This is the same discipline U2 applies to acquittal, applied to the reason string.
- **Test scenarios:** AE4 blocks with the new reason and no `shares` clause; `report_cites_restate_evidence` still shows `shares counter` and `increment ↔ +=` for a real overlap.
- **Verification:** as U2, plus check 4.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets` | all | one-shot repo gate green |
| 2 | `cargo test --test laundering` | U1, U2, U3 | zero spares on marker-plus-restatement rows |
| 3 | `cargo mutants --file crates/comment-checker/src/classify.rs --timeout 90` | U2, U3 | 100%, per the project rule for classifier changes |
| 4 | `cargo test --test f1` | U4 | per-kind floors hold on re-derived labels |
| 5 | `cargo test --test laundering -- ae4` | U5 | AE4 reason carries no `shares` clause |

---

## Definition of Done

- [ ] U1: probe fixture in-repo; the 18 rows are a test.
- [ ] U2: proven restatement pre-empts `JUSTIFIED`; AE1 blocks, AE2 passes.
- [ ] U3: attribution is lead-position tags only; AE3 blocks.
- [ ] U4: corpus re-adjudicated; floors hold or the move is argued.
- [ ] U5: no conviction claims restatement without citing it.
- [ ] Repo one-shot gate and classifier mutation both green.

## Risks

- **Over-conviction of legitimate why-comments.** The pre-emption is gated on *cited* evidence (KTD2), so a comment with no token overlap cannot be pre-empted. AE2 is the guard, and U1 pins it before the change.
- **Corpus churn masquerading as a win.** U4 can produce a better F1 by relabelling toward the new rule. Mitigation: the per-kind floors are re-run unchanged, and a floor that has to move is reported rather than edited.
- **Mutation score regression.** Reordering `classify` adds a branch that mutants will probe. Check 3 is the gate; a surviving mutant means a missing test, not a threshold to relax.
- **Precedence inversion changes directive handling.** A linter directive that restates its line must stay justified. U2's third test scenario is the guard; if it fails, the pre-emption needs a machine-read exemption ahead of it.
