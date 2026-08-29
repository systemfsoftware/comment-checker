---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-08-29
updated: 2026-08-29
type: feat
---

# Ship a self-contained .claude-plugin/marketplace.json catalog

## Goal Capsule

- **Objective:** A user can install `comment-checker` directly from the repository with a marketplace command (`omp plugin marketplace add systemfsoftware/comment-checker` or `/marketplace add systemfsoftware/comment-checker`) without a catalog-not-found error. The repo serves as both a standalone plugin and a self-contained marketplace source.
- **Means:** Add a valid Claude Code marketplace catalog at `.claude-plugin/marketplace.json` listing the existing `comment-checker` plugin with `source: "./"` (KTD1). Existing `.claude-plugin/plugin.json` and `hooks/hooks.json` are unchanged.
- **Product authority:** Issue #75 (`systemfsoftware/comment-checker`), area `marketplace`.
- **Open blockers:** None.
- **Execution profile:** code. One unit: add the catalog file.
- **Stop conditions:** `.claude-plugin/marketplace.json` exists, is valid JSON, names the marketplace `comment-checker-marketplace`, lists `comment-checker` with `source: "./"`, and marketplace discovery succeeds.
- **Tail ownership:** PR opened by the caller after this plan is written.

---

## Product Contract

### Summary

The repository ships `.claude-plugin/plugin.json` (verified) and `hooks/hooks.json`, but no marketplace catalog. Claude Code and OMP marketplace installers need `.claude-plugin/marketplace.json` to discover and install the plugin. This plan adds that catalog pointing at the repo root.

### Problem Frame

Measured on this branch (2026-08-29):

- `.claude-plugin/plugin.json` exists, `name: "comment-checker"`, `version: "0.3.0"`, tracked in git.
- `hooks/hooks.json` and `hooks/run.ts` exist, tracked, and must remain intact.
- No `.claude-plugin/marketplace.json` and no `.omp-plugin/` directory exist, so marketplace catalog discovery fails.
- A marketplace installer reports: `Marketplace catalog not found at ".omp-plugin/marketplace.json" or ".claude-plugin/marketplace.json".` (issue #75 evidence). The `.claude-plugin/marketplace.json` path satisfies both OMP and Claude Code discovery.

Adding the catalog makes the existing plugin installable without a consumer-authored external catalog or raw git workarounds.

### Requirements

- **Catalog file**
  - R1. `.claude-plugin/marketplace.json` exists in the repository and contains valid JSON. Gate: `jq empty .claude-plugin/marketplace.json` exits 0.
  - R2. The catalog top-level `name` is `comment-checker-marketplace`. The catalog lists exactly one plugin, `comment-checker`, with `source: "./"`.
  - R3. The catalog claims required schema fields for Claude Code discovery: top-level `name` (kebab-case, not a reserved marketplace name), `owner.name`, and a `plugins` array whose single entry has `name` and `source`.
  - R4. The catalog's `source: "./"` resolves relative to the repository root (the marketplace root), so the plugin root is the repository root, where `.claude-plugin/plugin.json` already lives.
- **Non-regression**
  - R5. `.claude-plugin/plugin.json` and `hooks/hooks.json` are byte-identical after the change.
  - R6. The change introduces no new version-sync surface: `.claude-plugin/marketplace.json` is not added to `scripts/lib/version-files.ts` or `check-versions.ts`, and carries no plugin `version` field that a future reader could mistake for a sync surface.

### Key Decisions

- KD1. **Ship the marketplace catalog in `.claude-plugin/` alongside `plugin.json`, per the dual plugin+catalog convention of the reference plugin.** Governs R1, R2, R4.
- KD2. **Name the marketplace `comment-checker-marketplace`, per the issue's acceptance criterion; it is not a reserved Claude Code marketplace name.** Governs R2.
- KD3. **Keep `plugin.json` and `hooks/hooks.json` unchanged.** Governs R5.
- KD4. **Treat `marketplace.json` as a catalog manifest, not a plugin version surface; the existing version gate (`version-files.ts` / `check-versions.ts`) does not change.** Governs R6.

### Success Criteria

- A marketplace command resolves `comment-checker@comment-checker-marketplace` against the repository root without a catalog-not-found error. The deterministic gate is the `jq empty` check (R1) plus schema-required field presence (R3); live installer confirmation runs when a `claude`/OMP CLI is available.

### Scope Boundaries

**In scope**

- `.claude-plugin/marketplace.json` — new file, the only work item.

**Deferred to Follow-Up Work**

- Publishing the plugin to an external Anthropic/OMP directory. This catalog ships in-repo; listing it elsewhere is a separate decision.
- Documenting marketplace installation in `README.md`. Optional, not required by issue #75 acceptance.

**Outside this product's identity**

- Replacing or editing `.claude-plugin/plugin.json` or `hooks/hooks.json`.
- Publishing `marketplace.json` with an external or hardcoded URL source instead of relative `./`.
- Wiring `marketplace.json` into the version-sync gate.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Author `.claude-plugin/marketplace.json` as a Claude Code marketplace catalog mirroring the reference plugin's shape.** Required top-level fields are `name`, `owner`, and `plugins`; the single plugin entry carries `name` and `source: "./"`. The reference `EveryInc/compound-engineering-plugin/.claude-plugin/marketplace.json` is the established convention this plan mirrors (verified by reading that file). Governs R1, R2, R3, R4.
- KTD2. **Omit a plugin `version` field from the catalog.** The Claude schema requires only `name`/`owner`/`plugins`; marketplace `source: "./"` resolves to an in-repo `plugin.json` that already carries the authoritative `version`. This keeps `marketplace.json` outside the version-sync surface (`scripts/lib/version-files.ts` does not reference it), so no gate change is needed and no drift risk is introduced. Governs R6.
- KTD3. **Use `"source": "./"` exactly (with the trailing slash), not `"."`.** Relative catalog sources must start with `./`; `"."` fails schema validation. `./` resolves to the marketplace root (the repository root), which is the plugin root. Governs R2, R4.

### Assumptions

- The `.claude-plugin/marketplace.json` path satisfies OMP discovery. The issue's observed error names `.omp-plugin/marketplace.json` OR `.claude-plugin/marketplace.json` as accepted catalog paths (user-reported, issue #75); OMP loads the `.claude-plugin/` catalog.
- The repo root is the plugin root for `source: "./"`, so Claude Code finds `.claude-plugin/plugin.json` at the plugin root. Verified: `plugin.json` lives at `<root>/.claude-plugin/plugin.json`.
- `comment-checker-marketplace` is not a reserved marketplace name (reserved set does not include it, per official Claude marketplace docs).
- The exact-JSON byte shape (indentation, field order, no `$schema`) still validates under `jq empty` and passes Claude Code's loader, which ignores `$schema` if present; the minimal catalog is schema-valid without it (verified against the official schema's required fields).

### Sequencing

Single unit. `U1` is the full change; nothing precedes it.

---

## Implementation Units

### U1. Add the marketplace catalog

- **Goal:** The repository becomes a self-contained marketplace source: `.claude-plugin/marketplace.json` declares `comment-checker-marketplace` and points the `comment-checker` plugin at the repo root.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** none
- **Files:**
  - `.claude-plugin/marketplace.json` — new file
- **Approach:**
  1. Create `.claude-plugin/marketplace.json` with the required top-level `name`, `owner`, and `plugins` fields, mirroring the reference plugin's shape.
  2. Set top-level `name` to `comment-checker-marketplace` and `owner.name` to `systemfsoftware`.
  3. Add one plugin entry: `name: "comment-checker"`, `source: "./"`.
  4. Optionally add a `metadata.description` for catalog readability; do **not** add a top-level or plugin `version` field (KTD2).
  5. Leave `.claude-plugin/plugin.json` and `hooks/hooks.json` byte-identical.
  6. Do not edit `scripts/lib/version-files.ts`, `scripts/tools/check-versions.ts`, workflows, or the hook files.
- **Patterns to follow:** The reference catalog `.claude-plugin/marketplace.json` in `EveryInc/compound-engineering-plugin` (dual plugin+catalog convention; single plugin entry with `source: "./"`).
- **Test scenarios:**
  - `Test expectation: none for automated unit coverage -- this is a single static config/JSON file with no runtime logic. Verified by the deterministic gate checks in Verification:`
    - `jq empty .claude-plugin/marketplace.json` exits 0 (R1).
    - `.name == "comment-checker-marketplace"`, exactly one plugin named `comment-checker` with `.source == "./"` (R2, R3).
    - `git diff --exit-code .claude-plugin/plugin.json hooks/hooks.json` is clean after the change (R5).
    - `check-versions.ts` still green with the catalog present (R6).
- **Verification:**
  - `jq empty .claude-plugin/marketplace.json` (deterministic JSON-validity gate, acceptance 1).
  - `jq -e '.name == "comment-checker-marketplace" and (.plugins | length == 1) and .plugins[0].name == "comment-checker" and .plugins[0].source == "./"' .claude-plugin/marketplace.json`.
  - Marketplace discovery: `omp plugin marketplace add systemfsoftware/comment-checker` resolves without a catalog-not-found error when an OMP CLI is available; equivalent `claude plugin validate .` from the repo root passes when `claude` is available.
  - `git diff --exit-code .claude-plugin/plugin.json hooks/hooks.json` to confirm no regression.

---

## Verification Contract

| # | Check | Applies | Done signal |
|---|---|---|---|
| 1 | `jq empty .claude-plugin/marketplace.json` | U1 | exit 0 (valid JSON) |
| 2 | `jq -e '.name == "comment-checker-marketplace" and (.plugins | length == 1) and .plugins[0].name == "comment-checker" and .plugins[0].source == "./"' .claude-plugin/marketplace.json` | U1 | exit 0 |
| 3 | `git diff --exit-code .claude-plugin/plugin.json hooks/hooks.json` | U1 | no diff (files untouched) |
| 4 | `deno run --allow-read scripts/tools/check-versions.ts` | U1 | exit 0 (version gate unaffected; catalog not a surface) |
| 5 | Marketplace discovery smoke (when CLI available): `omp plugin marketplace add systemfsoftware/comment-checker` or `claude plugin validate .` | U1 | resolves without catalog-not-found; validate passes |

---

## Definition of Done

- [ ] U1: `.claude-plugin/marketplace.json` exists, is valid JSON (`jq empty` exit 0), names `comment-checker-marketplace`, lists `comment-checker` with `source: "./"`, and carries required schema fields. `.claude-plugin/plugin.json` and `hooks/hooks.json` are byte-identical. `check-versions.ts` green. Marketplace discovery resolves the plugin from the repo root.

## Risks

- **Relative-source resolution.** A `source` that does not start with `./` (e.g. `"."`) fails Claude Code's marketplace schema. Mitigation: KTD3 pins `"./"` verbatim; acceptance 2 checks the exact value.
- **Reserved marketplace name.** An invalid top-level name would be rejected and shadowed by Claude Code's reserved-name list. Mitigation: `comment-checker-marketplace` is not reserved (verified against the official list); acceptance 2 checks the name.
- **Catalog mistaken for a version surface.** A future reader could expect `marketplace.json` to sync with the plugin version. Mitigation: KTD2 omits a version field and R6/DOD keep the catalog out of `version-files.ts`, so no drift surface exists to confuse.