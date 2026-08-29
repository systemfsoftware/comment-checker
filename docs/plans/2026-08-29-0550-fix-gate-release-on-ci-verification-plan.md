---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-29
updated: 2026-08-29
type: fix
title: Gate release workflow on CI verification before publishing - Plan
---

# Gate release workflow on CI verification before publishing

## Goal Capsule

- **Objective:** A push to `master` that fails any required verification gate never builds release binaries, publishes npm packages, or pushes release tags / creates a GitHub release — the `Release` workflow's `release` and `publish` jobs wait on the gate workflows before any publish-phase step runs.
- **Means:** `release.yml` calls the existing reusable gate workflows (`rust-gate.yml`, `js-gate.yml`, `tools.yml`, `mutation.yml`) as caller jobs and declares them in `needs` of `release` and `publish` (KTD1).
- **Product authority:** GitHub issue #76 (priority:p1, area:ci) — "Gate release workflow on CI verification suites before publishing on master".
- **Open blockers:** None.
- **Execution profile:** code. One workflow file changes; no scripts, no Rust/TS code.
- **Stop conditions:** `lint-workflows.ts` (actionlint) exits 0 on `.github/workflows/release.yml`; the `release` and `publish` jobs name the four gate jobs in `needs`; a failing gate job on a `publish`-phase run leaves `release`/`publish` skipped.
- **Tail ownership:** `ce-work` after this plan is written (pipeline).

---

## Product Contract

### Summary

`release.yml` currently runs `plan → release → publish` on every master push with no dependency on the verification gates, which `ci.yml` runs in a separate workflow. This plan adds four caller jobs to `release.yml` that invoke the existing reusable gate workflows, and makes the `release` and `publish` jobs wait on them. `ci.yml` is not modified. The `version` phase (release PR creation) is not gate-blocked: it publishes nothing, and its PR runs the same gates via `pull_request` CI.

### Problem Frame

When a commit lands on `master`, GitHub starts `release.yml` and `ci.yml` as two independent workflows with no cross-workflow dependency. `ci.yml` runs `rust-gate.yml`, `js-gate.yml`, `tools.yml`, `mutation.yml`, and a `platform.yml` rehearsal; `release.yml` calls `platform.yml` in `release` mode and runs the `publish` job (npm publish via OIDC, tagging, GitHub release creation) without ever seeing the gate verdicts. A red master — failing Rust tests/clippy, failing JS build/lint, or failing tool checks — still ships binaries and tags to the public registry. Issue #76 (measured at commit `f81a2e3`, evidence cited in the issue body) names this as the defect. GitHub Actions has no cross-workflow dependency mechanism, so the fix must call the gates from inside `release.yml`.

### Requirements

**Gate set**

- R1. `release.yml` invokes the existing reusable workflows `rust-gate.yml`, `js-gate.yml`, `tools.yml`, and `mutation.yml` as caller jobs — mirroring `ci.yml`'s caller pattern — and never duplicates their step definitions. (Issue Orientation; Non-Counting: "Duplicating steps... instead of invoking the reusable gate workflows".)
- R2. The `release` job waits on `plan` and on every gate job; a failed or skipped gate job leaves `release` not run.
- R3. The `publish` job waits on `plan`, `release`, and every gate job; a failed or skipped gate job leaves `publish` not run — blocking artifact publication, npm publishing, tagging, and GitHub release creation. (Issue AC2/AC3)
- R4. Gate jobs apply only to the publish phase (`phase == 'publish'`); the `version` phase keeps its current behavior and is not gate-blocked. (Issue Goal brackets "before any packaging, npm publishing, tagging"); the version phase only opens a PR.)

**CI integrity**

- R5. `ci.yml` is not modified and continues running its full check fleet on every master push and PR. (Non-Counting: "Disabling or deleting CI checks in `ci.yml` to make the release pass".)

**Validation**

- R6. `.github/workflows/release.yml` parses as valid GitHub Actions syntax per the repo's workflow linter (`lint-workflows.ts`, actionlint, pinned image — the gate that already runs in `js-gate.yml` for issue #9). (Issue AC1)

### Key Decisions

- KD1. **The release gate set is rust-gate, js-gate, tools, and mutation.** Governs R1. The issue's Goal enumerates "Rust tests/clippy, JS build/lint, tool checks"; its Problem Statement additionally names mutation checks among the failures that currently slip through. Mutation is included (see Assumptions A1) so a red mutation verdict cannot publish.

### Acceptance Examples

- AE1. Red gate blocks publish
  - **Covers:** R2, R3
  - **Given** a master push whose `rust-gate`, `js-gate`, `tools`, or `mutation` caller job fails, **When** the `Release` run reaches the publish phase, **Then** the `release` and `publish` jobs stay skipped, no artifacts leave the run, no npm package is published, and no tag or GitHub release is created.
  - **Given** a master push whose gates all pass **When** the publish phase runs, **Then** `release` and `publish` execute exactly as today.

### Scope Boundaries

**In scope**

- `.github/workflows/release.yml` — add gate caller jobs; re-point `needs` on `release` and `publish`.

**Out of scope**

- `ci.yml` — unchanged (R5).
- `rust-gate.yml`, `js-gate.yml`, `tools.yml`, `mutation.yml`, `platform.yml` — unchanged; they are call targets only.
- Gate content (which commands each gate runs) — owned by the gate workflows.
- Cross-workflow dependency between separate runs of `ci.yml` and `release.yml` — impossible in GitHub Actions; the caller pattern (R1) is the mechanism.

#### Deferred to Follow-Up Work

- A `workflow_dispatch` trigger on `release.yml` to re-run a failed release after fixes, if release teams need it.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Gate by calling the reusable gate workflows from `release.yml` as caller jobs (the `ci.yml` pattern), not by any other mechanism.** Chosen over (a) an environment-approval job — protects publishing with human review but adds no verification and contradicts the issue's caller-pattern instruction; (b) duplicating gate steps inline — explicitly forbidden by the issue's Non-Counting list; (c) waiting on the `ci.yml` run — GitHub Actions has no cross-workflow dependency edge, so a `release.yml` job cannot `needs` a `ci.yml` job. A called workflow's failure fails the caller job, so `needs` on the caller jobs is a real gate. Primary source: GitHub Docs "Reusing workflows", caller-job supported keywords (`needs`, `if`, `permissions`).
- KTD2. **Gate jobs run only when `needs.plan.outputs.phase == 'publish'`; the `version` phase is not gate-blocked.** Chosen over gating both phases: the version phase opens/updates a release PR whose `pull_request` CI already runs the same four gates; blocking on them here would add duplicate runs and no protection. A skipped gate job plus the existing `if: needs.plan.outputs.phase == 'publish'` on `release`/`publish` leaves their behavior unchanged in the version phase.

### Assumptions

- A1. **`mutation.yml` gates the release in addition to the three gates the issue's Goal/AC enumerate.** (Inferred bet, pipeline mode — unvalidated against the user.) Rationale: the issue Problem Statement names mutation checks among the failures that currently slip through, and the fail-closed direction for release gates favors gating on every verification suite; the call runs at the same commit as the `ci.yml` mutation run, so it adds no wall-clock latency to the release path. Rejected alternative: excluding mutation so the release cadence stays independent of the slow, turbo-verdict-cache-dependent mutant loop (see Risks). Either way `ci.yml` still runs mutation on every push; this bet only decides whether a red mutation verdict stops the release.
- A2. `lint-workflows.ts` is the canonical YAML-parse gate for this repo (it runs inside `js-gate.yml`; actionlint pinned image; issue #9). Any other workflow-linter verdict is secondary.

### Sequencing

U1 and U2 both edit `.github/workflows/release.yml` and land in one commit — U1 adds the gate caller jobs (no behavioral change yet: nothing depends on them), U2 re-points `needs` (the behavioral flip). The commit is atomic; the two units only keep the diff reviewable.

---

## Implementation Units

### U1. Add verification gate caller jobs to release.yml

- **Goal:** `release.yml` invokes the four reusable gate workflows as caller jobs, mirroring `ci.yml`.
- **Requirements:** R1, R6
- **Files:** `.github/workflows/release.yml`
- **Approach:**
  1. Add four jobs — `rust-gate`, `js-gate`, `tools`, `mutation` — each `uses: ./.github/workflows/<gate>.yml` with `permissions: contents: read`, `needs: plan`, and `if: needs.plan.outputs.phase == 'publish'`.
  2. Match `ci.yml`'s caller shape exactly (same job names as the workflow names; same permission block) so the two call sites stay visually parallel.
- **Patterns to follow:** `ci.yml` gate callers (`.github/workflows/ci.yml`), `lint-workflows.ts` pin practice for actionlint.
- **Test scenarios:**
  - Scenario 1 (action lint): `lint-workflows.ts` exits 0 on the modified `release.yml` — covers the YAML-syntax acceptance criterion.
  - Scenario 2 (phase skip): with `phase=version`, each gate job's `if` is false and `release`/`publish` remain skipped exactly as today — verify by reading the run graph on an actual version-phase push, or by actionlint's `needs`/`if` evaluation (actionlint validates the expressions statically).
- **Verification:** `lint-workflows.ts --color release.yml` (or the repo's workflow-lint gate in `js-gate.yml`) reports `ok`; the diff shows four caller jobs structurally identical to `ci.yml`'s.

### U2. Gate release and publish on the gate jobs

- **Goal:** A failed gate blocks artifact publication, npm publishing, tagging, and GitHub release creation.
- **Requirements:** R2, R3, R4, R5
- **Files:** `.github/workflows/release.yml`
- **Approach:**
  1. `release:` change `needs: plan` to `needs: [plan, rust-gate, js-gate, tools, mutation]`, keeping the existing `if: needs.plan.outputs.phase == 'publish'`.
  2. `publish:` keep `needs: [plan, release]` and add the four gate jobs: `needs: [plan, release, rust-gate, js-gate, tools, mutation]`. The transitive dependency through `release` already covers this; listing the gates again is the AC-literal reading ("release and publish jobs... declare explicit dependencies on verification gates") and is defense-in-depth if `release` is ever removed from `publish`'s `needs`.
  3. Do not touch `ci.yml` (R5) or the gate workflows.
- **Patterns to follow:** existing `needs` idiom in `release.yml` (`version: needs: plan`, `publish: needs: [plan, release]`).
- **Test scenarios:**
  - Scenario 1 (gate failure blocks publish, AE1): in an `actions` run where one gate caller job fails, the `release` and `publish` jobs report skipped and no publish/tag step runs — observable on the next master push after merge; before that, the equivalent behavior is already proven by GitHub's documented semantics (a failed called workflow fails the caller job; dependents with `needs` skip).
  - Scenario 2 (all green still publishes): a fully green publish-phase run executes `release` and `publish` unchanged — verify on the next real release.
  - Scenario 3 (version phase unaffected): a version-phase run (`phase=version`) shows the gate jobs skipped and the release PR opened as today.
- **Verification:** `lint-workflows.ts` exits 0; the `needs` arrays on `release` and `publish` name all four gate jobs; `git diff` shows no change outside `.github/workflows/release.yml`.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `./scripts/tools/lint-workflows.ts` (actionlint, docker/podman, pinned image) | after U1/U2 | exits 0 and prints `ok (.../release.yml)` — this is the AC1 gate; it also statically evaluates `needs`/`if` expressions |
| 2 | `git diff` scope review | after U2 | only `.github/workflows/release.yml` changed; `ci.yml` and gate workflows untouched |
| 3 | Needs-graph review | after U2 | `release` and `publish` list the four gate jobs in `needs`; gate jobs carry `if: needs.plan.outputs.phase == 'publish'` |
| 4 | Next master push observation (post-merge) | after the plan ships | a publish-phase run where a gate fails leaves `release`/`publish` skipped; a green run publishes exactly as before. Full behavioral proof of AC3 is only observable on a master push (release.yml fires only on master), so this is a scheduled post-merge check, not a pre-merge command |

`release:validate` does not exist in this repo; the workflow linter above is the applicable gate.

## Definition of Done

- [ ] U1: four gate caller jobs (`rust-gate`, `js-gate`, `tools`, `mutation`) present in `release.yml`, mirroring `ci.yml`, each gated to the publish phase.
- [ ] U2: `release` and `publish` declare `needs` on all four gate jobs; failing gates skip them.
- [ ] Verification Contract rows 1-3 pass; row 4 scheduled and owned by the merge PR.
- [ ] Cleanup criterion: no temporary workflow files, no debugging steps, no changes outside `release.yml`.

## Risks

- **Turbo verdict-cache fragility in the mutation gate.** `mutation.yml`'s verdict cache has two hash surfaces with a documented superset rule (`CONCEPTS.md` "Mutation gate / Verdict cache"; solution doc `cached-gate-task-scope-exceeds-determinants`). A broken cache would redden the mutation caller and stall a release. Mitigation: the same cache breakage reddens `ci.yml`'s mutation run at the same commit, so the release is stopped for a signal that already marks master red — the gate is compounding an existing verdict, not inventing a new one. If mutation becomes a release-stalling flake, revisit A1 (drop mutation from the gate set) as a follow-up PR.
- **Duplicate gate execution on master pushes.** With the caller pattern, the four gates run once in `ci.yml` and once in `release.yml` per master push (issue-prescribed; see KTD1). Cost is bounded by the gates' CI minutes; accepted to get a real dependency edge.
- **Gate-job `if` interaction with skipped jobs.** A gate skipped in the version phase must not skip `release`/`publish` — their own `if` already evaluates false in that phase, matching today's behavior. actionlint validates the expressions; scenario 3 covers the run graph.
- **Actionlint tool availability.** `lint-workflows.ts` needs docker or podman on the verification machine; in GitHub CI it runs inside `js-gate.yml` with the pinned image, so the shipped gate is the CI one.