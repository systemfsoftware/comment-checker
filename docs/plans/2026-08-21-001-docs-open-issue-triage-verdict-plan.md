---
title: Open-Issue Triage: Verdict Document - Plan (Revised)
type: docs
date: 2026-08-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Open-Issue Triage: Verdict Document - Plan (Revised 2026-08-21)

## Goal

- **Objective:** Authorize `docs/residual-review-findings/185fa9144.md` — a review document classifying all seven open issues (#3–#9) with verdicts and evidence. The prior "close #4/#9 as non-issue" decision is REVERSED by the adjudicated review: both falsified claims were corrected, no closure survives.
- **Authority:** Implementation runs autonomously on the session model, gated by the Verification Contract. Classification is settled by the session evidence recorded in this plan and the four-reviewer doc review.
- **Stop conditions:** stop at step 2 if a verdict repudiation surfaces (a closed issue's evidence is disproved by code) — record and reopen. This stop condition FIRED this session: #4's "BinaryNotFound cannot occur" and #8's "vacuous pass" were falsified; #9's "generic, no project defect" was overstatement. Plan applied the adjudication before authoring.
- **Execution profile:** docs only — no GitHub issue mutations (no closures), no workspace code changes, no branch/workflow/toolchain edits.
- **Tail ownership:** plan written; execution and PR handling owned by the LFG pipeline through steps 2–9.

## Adjudication (4-reviewer doc review, applied 2026-08-21)

| Finding | Disposition |
|---|---|
| #4: launcher raises BinaryNotFound (runnable path); platform manifests ship `files:[entry.bin]` | Accept — verdict flips `non-issue` -> `real-but-corrected`. No close. |
| #9: "generic, no project-specific defect" overstatement | Accept — verdict stays open with corrected framing: real exposure on the only live publish path. No close. |
| #8: checkWorkflow passes vacuously | Accept corrected mechanism — gate FAILS LOUDLY (repro: exit 1, 5 FAILs) on flow-style. Valid YAML is falsely rejected. Remains open. |
| #8: `RELEASE_WORKFLOW` symbol not existing | Accept — cite `RELEASE_WORKFLOW_PATH` + inline `content.matchAll(...)` in `checkWorkflow`. |
| Verification `--jq` has no expression; `--json body` misses `comments` | Accept — use `--json number,state,comments --jq '{...}'`, and post-close comment count is 2 if a count assertion is used. |
| `git status` expected set incomplete (`plans/` untracked too; dir collapse) | Accept — assert with `-uall`; expect the plan file + the new doc as the untracked set. |
| `Git` "steps 2–9" ambiguous | Accept — define steps 1–2 in Sequencing. |
| Summary attributed corrections to all five open findings | Accept — corrections apply to #6 and #7 only (severity). |
| F8 referent defined nowhere in repo | Eliminated with the #4 flip; no bare F8 remains. |
| Corpus nil probe: no authoritative answer in software-wiki | Accept as recorded; no re-run result added. |
| Stop: reopening paths / single-actor closure | MOOT for this revision: no closure mutation runs; only the corrected record is written. |
| #7: release sidecar file never written at HEAD (guard inoperative, not weak) | Accept — #7 stays P1, mechanism corrected to confirmed-defect (sidecar no producer). Plan + record both re-anchored. |
| #9: 'npm job gates deno lint + check-matrix only' omits pnpm gates | Accept — corrected to list all four gates; none validates workflow YAML. |

## Summary

The seven open issues are residual findings from PR #10. Each was filed as "advisory, defer." This revised plan classifies every issue against the current code and this session's reproduction evidence, records the verdicts in a committed review document, and — after a four-reviewer doc review falsified the two planned closures — keeps **all seven open**. #4 and #9 were provisionally `non-issue` in the first plan draft; the review disproved each premise (the launcher's BinaryNotFound path is live, and the missing workflow-YAML gate is a real exposure on the only publish path), so those verdicts are corrected in the record, not closed. Severity corrections are recorded for #6 (kept P3); #7 retains its filed P1 because the code review proved its guard inoperative. No GitHub issue mutation runs.

## Problem Frame

The issues triage happened in chat but left no durable record. GitHub issues remain open, and the first plan draft asserted two closed-with-evidence calls (#4, #9) whose premises the doc review disproved. The repo needs a committed verdict record so future sessions and maintainers can trust the open list — and the record must carry the corrected mechanisms (the launcher does raise BinaryNotFound; the check-matrix gate fails loudly rather than vacuously; the #7 sidecar guard is inoperative because no step writes the file), not the falsified first-draft claims.

## Product Contract

### Requirements

**Verdicts**

- R1. The review document classifies every currently-open issue (#3–#9) with exactly one verdict: `confirmed-defect`, `real-but-corrected`, or `non-issue`.
- R2. Every verdict is grounded in evidence visible in the document: a repo-relative path + symbol, and/or a reproducible tool probe result. No bare verdicts.
- R3. Issues with verdict `non-issue` are closed on GitHub after a comment that leads with the evidence. This plan produces **no** `non-issue` verdicts after the review — the previously-planned #4/#9 closures were falsified — so R3 does not fire.
- R4. Issues with verdict `confirmed-defect` or `real-but-corrected` remain open. The document records their severity corrections; code fixes are explicitly out of scope for this plan.

**Record and scope**

- R5. The review document is the durable record at `docs/residual-review-findings/185fa9144.md` — one file, committed on a feature branch, no `## Next Steps` or lifecycle metadata.
- R6. This plan changes no workflows, no release scripts, no `AGENTS.md`, no `README.md`, and no issue states (all seven stay open).

### Scope Boundaries

**In scope:** the triage document with the corrected verdicts; no GitHub mutations; open-issue states preserved.

**Deferred to Follow-Up Work:** fixes for the confirmed defects (#3 tag-reachability, #5 concurrency race, #7 sidecar self-trust, #8 regex gate, #6 contract test) and the backlog candidate (#9 actionlint YAML gate). These are filed as issues (already open) and earn their own PRs; this plan does not touch release.yml, check-matrix.ts, or classify.rs.

**Outside:** changing issue bodies, modifying workflows, editing instructions files, closing any confirmed-defect issue, or adding project code.

### Outstanding Question (deferred, non-blocking)

- Q1. (deferred) Should a permanent "actionlint / workflow YAML gate" be added to CI? This plan records the gap as a real, uncorrected exposure (#9) but does not implement the gate; the improvement idea remains on the record as a separate backlog candidate.

### Sources / Research

- Local evidence for #4 (corrected): `npm/packages/comment-checker/src/index.ts` — launcher `getBinaryPath` resolves `package.json` for the platform package via `require.resolve`, and raises tagged `BinaryNotFound(...)` when it cannot: `catch: () => new BinaryNotFound({ package: pkg, message: "the npm platform package for ${platform}/${arch} (...) is not installed" })`. `scripts/lib/platform-manifest.ts` `buildPlatformManifest` emits `files: [entry.bin]` — platform packages DO ship the binary. A direct platform install (issue #4) can therefore surface the BinaryNotFound error when the launcher's expected platform package is absent or unlinked; the peerDependencies cross-link recommendation stands as a real (P2) improvement.
- Local evidence for #9: `.github/workflows/ci.yml` npm job runs `pnpm lint`, `pnpm build && pnpm typecheck`, `deno task lint`, and `deno task check-matrix` — none of which validates workflow YAML or GitActions expressions; `scripts/tools/check-matrix.ts` `checkWorkflow` regex-scrapes `release.yml` matrix rows and does not parse YAML. No actionlint / YAML-parse / expression-validation gate exists anywhere, so step-syntax/quoted-target/drift errors surface at tag-run time.
- Local evidence for #8 (corrected mechanism): probe run this session against the current `scripts/tools/check-matrix.ts` with a flow-style `release.yml` (all 5 targets present, flow-style) → gate prints FAIL for each target ("release.yml does not list release target ...") and exits 1. It does NOT pass vacuously: `checkWorkflow` iterates `tablePairs` (from targets.json, never empty) first and emits `fail` plus `Deno.exit(1)`. Mechanism: false-positive rejection (gate over-fails valid drift variants), not vacuous pass.
- Local evidence for #5: `.github/workflows/release.yml` `concurrency.group: release-${{ github.ref }}` and `cancel-in-progress: false`; a force-moved tag reuses the lane.
- Local evidence for #7 (corrected post-review): `release.yml` staging step computes `SHA="$(sha256_of ...)"` into a shell variable and passes it only as `--binary-sha256` into the platform manifest (line 152-159); the upload step lists `${{ runner.temp }}/binary-${{ matrix.suffix }}.sha256` (line 175) and the cross-check step reads `sidecars/binary-${SUFFIX}.sha256` (line 277) — but no step writes the `.sha256` file at HEAD. The guard is inoperative, not merely weak; mechanism corrected.
- Local evidence for #6: release.yml smoke step `test "$rc" -eq 2`.
- Local evidence for #3: release.yml tag gate `git fetch origin "$DEFAULT_BRANCH" --depth=1` + `git merge-base --is-ancestor`.
- Local evidence for #8 file anchor: `RELEASE_WORKFLOW_PATH` in `scripts/lib/shared` + inline `content.matchAll(/.../gm)` inside `checkWorkflow` in `scripts/tools/check-matrix.ts`.
- Corpus query (software-wiki, `qmd`): queries for mechanisms in these issues returned no settled authoritative verdict (nil). Recorded 2026-08-21 so the next reader can re-run and falsify.

## Planning Contract

### Key Technical Decisions

- KTD1. **Issue #4 verdict: `real-but-corrected` (post-review)** — originally planned `non-issue`, falsified this session: the launcher's `BinaryNotFound` and `buildPlatformManifest`'s `files:[entry.bin]` prove a runtime resolution path exists. The peerDependencies cross-link recommendation is real hardening; the severity P2 is overstated for a documented/UX gap but the mechanism is live. Stays open (R4).
- KTD2. **Issue #9 verdict: `confirmed-defect` (post-review)** — no workflow YAML/expression validation goes anywhere; errors surface only at tag-run. Not "generic hardening with no project-specific defect" (draft KTD2 was overstatement); the missing gate is a real project exposure on the only publish path. Stays open.
- KTD3. **Issues #3/#5/#6/#7/#8: `confirmed` or `real-but-corrected`** — they stay open. #6 gets a severity correction (filed P3, real but low); #7 keeps its filed P1 — post-review code check found the guard is inoperative (sidecar never written), not merely weak; #8 mechanism is corrected (fail-loud rejection, not vacuous pass) but remains `confirmed`. Fix work is deferred to their own PRs.
- KTD4. **Closure mechanics: none** (chosen over silently posting falsified close comments). No issue is closed; the two proposed `non-issue` closures were withdrawn after the review falsified both premises.
- KTD5. **Document placement** (chosen over an issue-body comment or `docs/solutions/`): `docs/residual-review-findings/` is the LFG durable-record convention; the file name is the head-sha of the checked-out base. One committed file is the record.
- KTD6. **Verification via read + gh assertions only** (chosen over full-suite rerun): this is a docs-only change; local cargo development is not applicable. The Verification Contract runs `read`/`grep` and `gh issue list` read-only asserts.

### High-Level Technical Design

None required. The change is one artifact — a single Markdown record — with no component topology and no GitHub mutation.

### Sequencing

1. U1 writes the triage document (corrected verdicts + evidence).
2. U2 verifies the document (read-back + grep + probe anchors) and asserts the GitHub open-state set is unchanged (read-only).

## Implementation Units

### U1. Write the triage verdict document

- **Goal:** Create `docs/residual-review-findings/185fa9144.md` recording the seven verdicts, each with evidence.
- **Requirements:** R1, R2, R5.
- **File:** `docs/residual-review-findings/185fa9144.md` (new).
- **Approach:**
  - Read the current issue (#3–#9) to confirm the verdicts are against the live open list (done this session).
  - For each issue, write one verdict block: verdict, one-line stated, then `Evidence:` with a file-relative path + symbol or probe result inline. Take the verdicts from KTD1–KTD3.
  - Follow the doc content doctrine (agent-docs): every marked verdict shall have a named gate or evidence; quantitative/claim carries its source. No bare labels.
  - Use decision-first prose: `# Issue N — verdict` on the first line.
  - No horizontal rules or HTML; repo-relative paths only.
- **Test scenarios:**
  - The document contains exactly one verdict block per issue number 3–9; an issue number is omitted or a verdict label is absent -> fail.
  - Each `real-but-corrected` verdict carries an inline correction (for #4: the launcher BinaryNotFound path exists — quantify the code resolve; for #8: exact file + line + probe).
  - No `non-issue` verdict remains from the falsified first-draft premises; if the authoring session re-runs the probes and finds any `non-issue` it must be backed by a fresh live reproduction, not the old draft.
  - No absolute paths; no `## Next Steps`.
- **Verification:** read the file back; grep for each issue number `#<n>` and each verdict label; check the state `uncommitted` is created.

**U2. Verify the document and GitHub state (read-only)**

- **Goal:** Read back the document, re-grep verdict-anchors, and assert the GitHub open-issue set is unchanged (#3–#9 all open). No comment is posted, no issue closed.
- **Requirements:** R4, R5, R6.
- **Approach:**
  - Read the written document; verify one verdict block per issue and corrected inline evidence anchors.
  - `gh issue list --state open` → must equal #3, #4, #5, #6, #7, #8, #9 (set equality, order-insensitive).
  - `git status -uall` → expects the doc file `docs/residual-review-findings/185fa9144.md` (untracked) plus the untracked plan file `docs/plans/2026-08-21-001-docs-open-issue-triage-verdict-plan.md`; nothing else.
  - Do not touch any issue; do not post comments; do not `gh issue close` any issue.
- **Test scenarios:**
  - All seven issues remain open with no new comments.
  - The repository working tree contains only the new document + the plan file; no code, workflow, or AGENTS change.
- **Verification:** `gh issue list --state open` for the seven; `git status -` shows the docs files only.

## Verification Contract

- `gh issue list --state open` — must equal `#3, #4, #5, #6, #7, #8, #9` (set equality, order-insensitive). No issue changes state during or after this plan.
- `read` the written document back; grep for each issue number and each verdict label; grep that no falsified draft sentence remains: `BinaryNotFound.*cannot` and `vacuous` under the #8 block (both corrected to procedural anchors).
- `git status -uall` — only the new `docs/residual-review-findings/185fa9144.md` and the plan file untracked; no code, workflow, or issue-state change.
- On the PR: the repo's CI (`release` job not applicable; the workflow's `ci.yml` gate) must be green. Local `cargo` not installed on this host; the docs-only change doesn't touch Cargo/JS sources, so repo CI is the gate.
- If a re-run of any gate fails, it is reported via the PR path; do not weaken.

## Definition of Done

- `docs/residual-review-findings/185fa9144.md` is committed with the seven verified verdicts and evidence.
- All seven issues #3–#9 remain open, uncommented; no closure mutation ran.
- No code, workflow, `AGENTS.md`, `README.md`, or issue-state change; working tree contains exactly the new doc + plan files.
- CI on the branch PR is green; commit message reflects the `docs:` type.
- The document's inline evidence records the reviewed corrections (BinaryNotFound live-path for #4; fail-loud mechanism for #8; missing YAML gate for #9; inoperative sidecar guard for #7) rather than the falsified first-draft premises.
- Every file-relative claim in the doc is read this session and grounded in the sources above or the corpus nil recorded.

### Deferred to Follow-Up Work

- Fixes for #3, #5, #6, #7, #8 (each a separate PR; the triage doc lists them but does not implement).
- Optional actionlint gate on the CI backlog (#9 track).