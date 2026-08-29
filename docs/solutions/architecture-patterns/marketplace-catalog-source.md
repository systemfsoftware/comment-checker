---
title: Self-contained marketplace source — dual plugin+catalog convention
date: 2026-08-29
category: architecture-patterns
module: plugin packaging (.claude-plugin/ marketplace catalog, issue gh-75)
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - Adding or editing a Claude Code / OMP marketplace catalog in this repo
  - Making the repo installable as a standalone plugin without an external catalog
  - Deciding whether a new manifest participates in the version-sync gate
tags: [marketplace, catalog, claude-plugin, omp, plugin-distribution, version-sync]
---

# Self-contained marketplace source — dual plugin+catalog convention

## Context

A repository that ships `.claude-plugin/plugin.json` alone is installable only through an external catalog or a raw-git workaround. Claude Code and OMP marketplace installers look for a catalog at `.claude-plugin/marketplace.json` (OMP also accepts `.omp-plugin/marketplace.json`) and report `Marketplace catalog not found` when neither exists. Issue gh-75 made this repo a self-contained marketplace source by adding the missing catalog.

## Guidance

Ship two manifests side by side under `.claude-plugin/`:

- **`plugin.json`** — the authoritative plugin manifest. Carries the plugin `name`, `version`, and hook wiring; this is the version surface the release gate reads — `PLUGIN_MANIFEST` (declared in `version-sync.ts`, consumed by `bumpAllSurfaces`/`checkAllSurfaces` in `version-files.ts`).
- **`marketplace.json`** — the catalog that lets an installer discover and pull the plugin. Declares the marketplace and lists each plugin entry with its source.

The catalog shape:

```json
{
  "name": "comment-checker-marketplace",
  "owner": { "name": "systemfsoftware" },
  "metadata": { "description": "…" },
  "plugins": [
    { "name": "comment-checker", "description": "…", "source": "./" }
  ]
}
```

Three rules govern the catalog:

1. **`source` is `"./"` verbatim** (trailing slash), never `"."`. Relative catalog sources must start with `./`; `"."` fails the loader's schema validation. `./` resolves the plugin root to the marketplace root (the repo root), where `.claude-plugin/plugin.json` already lives.
2. **Omit a `version` field from both the catalog and its plugin entries.** The Claude Code schema requires only `name`/`owner`/`plugins`. The authoritative version lives in `plugin.json`; duplicating it into the catalog would make it a second place that can drift, and would drag the catalog into the release-sync gate. A catalog with no `version` field is not a version surface.
3. **Respect the reserved-name list.** The marketplace `name` must be kebab-case and not a reserved Claude Code marketplace name. `comment-checker-marketplace` is not reserved.

## Why This Matters

The invariant this pattern protects: **a repository is a self-contained installation target when its catalog lives beside its plugin manifest and the catalog carries no version of its own.**

- Without the catalog, installers fail with `Marketplace catalog not found` even though the plugin manifest is valid.
- A catalog that carries a `version` field becomes a second authoritative version. The release gate enumerates version surfaces explicitly (`version-files.ts`); adding a catalog to that list is a per-surface decision, and the default is to keep the catalog out of it so no drift risk is introduced.
- The `plugin.json` description is the authoritative user-facing text once installed; the catalog description is display-only copy that can drift. Keep the catalog description a stable one-liner or drop it.

## When to Apply

- When adding a plugin entry to the catalog, give it `name` and `source: "./"` exactly; do not invent a version for it.
- When wiring a new manifest into the release gate, treat that as an explicit decision, not a default: the version-sync surface is an explicit enumerated list and growing it must be deliberate.
- When editing the catalog, remember the deterministic `jq` gates validate JSON and field presence but cannot catch reserved-name, kebab-case, or `./`-prefix violations — the loader smoke test is the authoritative gate.

## Examples

Validated on this repo (pending merge on branch `gh-75`):

- `jq empty .claude-plugin/marketplace.json` exits 0; the single plugin entry is `comment-checker` with `source: "./"`.
- `.claude-plugin/plugin.json` and `hooks/hooks.json` are byte-identical after the change — the catalog is purely additive.
- No `marketplace` reference exists anywhere under `scripts/`; the version-sync surface (`version-sync.ts`) lists `PLUGIN_MANIFEST` for `plugin.json` but no marketplace file, confirming the catalog is not a version surface.

## Related

- `docs/solutions/architecture-patterns/rust-cli-npm-distribution.md` — the sibling distribution pattern for the npm/binary release side.
- `docs/plans/2026-08-29-001-feat-marketplace-catalog-plan.md` — the plan behind this change (gh-75).