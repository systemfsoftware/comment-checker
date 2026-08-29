# Code Review: marketplace catalog (gh-75)

- **Scope**: standalone review of branch `gh-75` (merge-base `ea5758a4b` = HEAD; zero commits). Reviewed working-tree files: `.claude-plugin/marketplace.json` (new), `docs/plans/2026-08-29-001-feat-marketplace-catalog-plan.md` (new). `.mcp.json` untracked but excluded (worktree-local codegraph socket config, machine-specific harness state).
- **Intent**: Make `systemfsoftware/comment-checker` installable as a standalone Claude Code/OMP plugin by adding a valid marketplace catalog (`.claude-plugin/marketplace.json`) naming marketplace `comment-checker-marketplace` and listing plugin `comment-checker` with `source: "./"`. `plugin.json` and `hooks/hooks.json` stay byte-identical; no new version-sync surface.
- **Mode**: agent (report-only, JSON). No mutations applied.
- **Reviewers**:
  - `correctness` (always-on; session tier)
  - `project-standards` (root `AGENTS.md` governs both changed files; no `CODING_STANDARDS.md` exists anywhere - instruction-file fallback)
  - `agent-native` (the change is itself the agent-install surface: a Claude Code/OMP marketplace catalog)
- Skipped conditionals: testing (no tests, no runtime behavior), maintainability (static config + doc, ~40 lines), learnings (no `docs/solutions/` match for marketplace/catalog), security/performance/api-contract/reliability/data-migration/stack-specific (no surface), adversarial (0 executable lines, config/doc-only, no silent-pass mechanism) -> cross-model pass not run (gate not met).

## Findings

### P3 -- Low

**#1 - Marketplace plugin description drifts from plugin.json description**
- Where: `.claude-plugin/marketplace.json:12`
- What: The plugin-entry `description` is a hand-copied subset of the `plugin.json` description. It already omits the sentence "Names flake.nix when that is why it is missing."
- Why it matters: `plugin.json` is the authoritative manifest once the plugin is installed. The duplicated text will drift further on every future description edit, and users will see different descriptions in the catalog versus the installed plugin.
- Response (advisory, decision): Shorten the catalog description to a stable one-liner, drop it entirely (the loader surfaces `plugin.json` on install), or copy the full `plugin.json` text verbatim.
- Confidence: 75 (verified: quoted both lines).

**#2 - Plan jq gates cannot catch loader schema rejections (silent-pass stand-in)**
- Where: `docs/plans/2026-08-29-001-feat-marketplace-catalog-plan.md:62` (and Verification Contract check #2, line 177)
- What: The plan's deterministic gate is `jq empty` plus jq literal-equality on name/source. jq cannot evaluate the constraints that actually make a catalog load: kebab-case naming, the reserved-name list, the `./` source prefix pattern. Official Claude Code docs state the loader re-checks reserved names on every load.
- Why it matters: A future edit that renames the marketplace to a reserved name, breaks kebab-case, or changes `source` to a non-`./` relative path passes the jq gates yet silently breaks discovery - the exact failure class issue #75 exists for. The current file conforms (verified against official docs and the real OMP loader), so this is a gate-fidelity gap for future edits, not a current defect.
- Response (advisory, decision): Make Verification Contract check #5 unconditional in the accepting workflow (`claude plugin validate .` or the OMP equivalent in CI after the PR exists), or extend check #2 with jq pattern checks (kebab-case regex + `source | startswith("./")`). The loader smoke test is the authoritative gate.
- Confidence: 75 (verified: quoted plan line + official docs + real loader behavior).

## Requirements Completeness

Plan: `docs/plans/2026-08-29-001-feat-marketplace-catalog-plan.md`, `ce-unified-plan/v1`, `artifact_readiness: implementation-ready`, `plan_source: explicit`.

| Requirement | Status | Evidence |
|---|---|---|
| R1 valid JSON at `.claude-plugin/marketplace.json` | met | `jq empty` exit 0 |
| R2 name `comment-checker-marketplace`, one plugin `comment-checker` with `source: "./"` | met | `jq -e ...` exit 0 |
| R3 required schema fields (`name`, `owner.name`, `plugins[].name/source`) | met | fields present; kebab-case, not in official reserved list |
| R4 `source: "./"` resolves to repo root (plugin root) | met | official docs relative-path semantics; `plugin.json` at `<root>/.claude-plugin/plugin.json` |
| R5 `plugin.json` + `hooks/hooks.json` byte-identical | met | `git diff HEAD` on both is clean |
| R6 no new version-sync surface | met | no `version` field in catalog; no `marketplace` reference in `scripts/lib` or `scripts/tools` |
| U1 add the marketplace catalog | met | implemented by the new untracked `marketplace.json` |

No requirements or implementation units are unaddressed, so no requirements-completeness findings are raised.

## Actionable Findings

Actionable findings: none. Both findings are P3 advisory with owner human (report-only).

## Pre-existing

None.

## Learnings & Past Solutions

Not applicable: no `docs/solutions/` match for marketplace/catalog.

## Agent-Native Gaps

None. The catalog is the agent-facing installation surface: 1/1 high-priority capability accessible (plugin marketplace install), verified against the real OMP loader. One wording nit: the plan's Goal Capsule writes `/marketplace add ...`; Claude Code's actual command is `/plugin marketplace add` (acceptance checks use the correct forms, so no finding).

## Coverage

- Reviewer execution: subagent spawning is disabled in this environment, so all three persona passes ran in the parent context. They are attributed evidence, not independent reviewer passes; no cross-model or cross-agent corroboration exists for these findings. The fast-pass scan found no P0/P1 candidates.
- Lite roster: not used (scope helper: `lite_eligible false`, exec_lines 0); correctness + project-standards + agent-native ran.
- Cross-model pass: not run (adversarial gate not met: 0 executable lines, config/doc-only change, no silent-pass mechanism).
- Validator batch: skipped (no P0/P1; no actionable findings).
- Suppressed: 0 by confidence; malformed returns: 0; pre-existing findings: 0. Settlement suppression not evaluated (no `session-settled:` KTDs in the plan).
- Residual risks: (1) OMP GitHub-shorthand discovery re-smoke needed after commit/push - the dry-run cloned `origin/master` which lacks the untracked catalog; (2) `claude plugin validate .` not runnable here (no `claude` CLI); schema verified against official docs and the real OMP loader; (3) a stale `comment-checker-marketplace` registration in this environment points at a vanished `/tmp/cc-marketplace` (harness state); (4) AGENTS.md verification gates are Rust-core and do not apply to a static JSON catalog.
- Live loader verification: `omp plugin marketplace add systemfsoftware/comment-checker --dry-run` fails only because the catalog is uncommitted (expected pre-merge); `omp plugin marketplace add <local path> --dry-run` parses the catalog and reaches the existing-name check, so the real OMP loader accepts the file and its marketplace name.

---
## Verdict: Ready to merge

Verified: JSON valid; name `comment-checker-marketplace`; single plugin `comment-checker` with `source: "./"`; `plugin.json`/`hooks/hooks.json` untouched; no version-sync surface; catalog accepted by the real OMP loader. All plan requirements (R1-R6) and unit U1 met. Both findings are P3 advisory opinions on future-proofing, no fix required before merge.

Next: commit the two untracked files, open the PR, and re-run `omp plugin marketplace add systemfsoftware/comment-checker --dry-run` on the merged master to confirm remote discovery end-to-end.

Actionable recap (empty queue): no `downstream-resolver` items. Optional polish: #1 description dedup; #2 make the loader smoke test unconditional after the PR exists.