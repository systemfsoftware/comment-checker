---
title: Distributing a compiled Rust CLI as per-platform npm packages
date: 2026-08-17
category: architecture-patterns
module: npm distribution (npm/packages/comment-checker + scripts/lib,tools + .github/workflows/release.yml)
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - Distributing a CLI compiled from Rust (or another compiled language) as npm packages to Linux, macOS, and Windows consumers
  - The binary must arrive as a plain dependency with no postinstall build or download step
  - Consumers or CI install with a frozen lockfile (pnpm) while the platform packages are unpublished until tag time
  - The npm org supports trusted publishing so release credentials can be OIDC-only
  - Native runners are available in CI for each platform/arch lane
tags:
  - npm-distribution
  - optional-dependencies
  - platform-packages
  - rust-cli
  - oidc-provenance
  - github-actions
  - pnpm
  - release-pipeline
---

# Distributing a compiled Rust CLI as per-platform npm packages

## Context

comment-checker is a Rust CLI shipped as a Claude Code hook; the npm
distribution must drop a working binary on every consumer's machine with
`npm i -g` / `npx` — no postinstall build, no download step. One package cannot
serve linux (x64 + arm64, glibc), darwin (x64 + arm64), and win32 x64 from a
single artifact, so the release surface is six packages: a root launcher plus
five per-platform binary packages. That shape creates two hard constraints:

1. **pnpm cannot lock unresolvable optional deps (pnpm#3960).** The platform
   packages do not exist in the registry until publish time, so a committed
   launcher manifest that names them in `optionalDependencies` breaks
   `pnpm install --frozen-lockfile` for every developer and CI run. The
   committed manifest must stay clean; the pins are injected at publish time
   (`scripts/lib/sync-root-version.ts:18-22`).
2. **Six packages by hand is exactly what a human gets wrong.** The pipeline
   must be tag-triggered (version = tag), run the same build → gate → smoke →
   publish sequence on every tag, publish platforms before the root, and fail
   loudly instead of shipping an absent or wrong-arch binary.

## Guidance

1. **Launcher resolves its platform package by identity at runtime.**
   `npm/packages/comment-checker/src/platform.ts` defines two pure helpers:
   `optionalDepName(platform, arch)` returns
   `<launcher>-<platform>-<arch>`; `binaryFileName(platform)` returns
   `comment-checker.exe` on win32, else `comment-checker`. The launcher
   (`npm/packages/comment-checker/src/index.ts`) resolves the platform
   package's own `package.json` via `createRequire` and joins the binary name
   to its directory. Missing package surfaces as a
   typed `BinaryNotFound` naming the package; a spawn-time ENOENT would be a
   corrupt install npm would not have produced.
2. **One canonical targets table.** `scripts/lib/targets.json` is the
   single source of truth: five entries, each `{target, suffix, os, cpu,
   libc?, bin}`. Everything else consumes the table instead of re-deriving
   the platform set — the workflow resolves the per-lane binary name with
   `jq` rather than duplicating the win32→`.exe` rule,
   `generate-platform-manifest.ts` rejects unknown suffixes against the table,
   and `check-matrix.ts` builds the agreement tests from it.
3. **Platform manifests are generated, cheap, and carry no `bin`.**
   `generate-platform-manifest.ts` renders each platform `package.json`: name
   = launcher name + `-<suffix>`, `os`/`cpu`/`libc` from the table,
   `files: [entry.bin]`, and **no `bin` field** — a platform-level bin would
   create a top-level `comment-checker` shim colliding with the launcher's own
   (esbuild precedent, comment at lines 60-62). `binarySha256` is recorded
   into the manifest when the caller passes it.
4. **The committed launcher manifest carries NO `optionalDependencies`.**
   pnpm cannot record unresolvable optional deps in a lockfile, so listing
   unpublished platform packages breaks frozen installs. `sync-root-version.ts`
   validates `VERSION` (strict semver regex, before any write), then injects
   `version` plus the five pins from `targets.json`, preserving the manifest's
   own formatting so an unchanged sync is byte-identical; `--dry-run` prints an
   LCS diff.
5. **Gate the matrix, not the script.** `check-matrix.ts` names the product
   platform set (`EXPECTED_SUFFIXES`, five entries — the known set, not a copy
   of the table), then checks three agreements: the table names exactly that
   set; the launcher manifest pins match the table exactly when present; and
   the workflow matrix rows match the table triples in both directions —
   missing, extra, and swapped `target`/`suffix` pairs are all failures.
6. **Release pipeline: one lane per platform, platforms before root.**
   `.github/workflows/release.yml` triggers only on `push: tags: v*` with
   `permissions: {}` at the top. Five matrix lanes, `fail-fast: false`, each:
   build → `check-matrix` gate → binary-exists gate → in-lane smoke (exit 0
   for a clean payload, 2 for a flagged one) → stage the platform package
   outside the workspace in `$RUNNER_TEMP` plus a binary sha256 sidecar →
   `pnpm publish --provenance` (OIDC, no `NODE_AUTH_TOKEN`, npm ≥ 11.5.1) →
   upload tarball + sha sidecar. The root job `publish-npm-main` needs all
   lanes, re-derives `VERSION` from the tag, requires the tag commit to be an
   ancestor of the default branch, verifies every published platform
   package's `version`/`os`/`cpu`/`libc` against the table, cross-checks the
   published tarballs' binary sha against the recorded sidecars, builds
   frozen, runs `sync-root-version.ts` with `VERSION` from the environment,
   publishes the root, and verifies the root's five pins are exact version
   pins. A final job attaches the tarballs to the GitHub release.
7. **Humans own one-time trust setup only.** OIDC trusted publishing is the
   no-token story: the npm trusted-publisher record binds workflow filename +
   environment (the npm form has no tag-pattern field), so the `tags: v*`
   filter is the tag gate and `pull_request_target` is deliberately unused.
   `docs/publishing/first-release-checklist.md` covers the six trusted-
   publisher records and post-publish manual spot checks.

## Why This Matters

- **The pnpm failure mode is a landmine, not an annoyance.** The moment
  someone adds `optionalDependencies` naming the platform packages to the
  committed manifest, every `pnpm install --frozen-lockfile` — developers and
  CI alike — breaks because the packages don't exist yet (pnpm#3960). It is
  caught by `check-matrix.ts`'s absence-is-expected branch and by the
  `pnpm install --frozen-lockfile` step of `docs/publishing/first-release-checklist.md`.
- **Version skew is structurally impossible at the consumer.** The root pins
  each platform package to the exact tag version (verified against the
  registry at release time). Because the root is published after the
  platforms, a consumer's install either gets the pinned, gated binary or
  fails to resolve — no in-between state.
- **The silent gate failure modes were observed, so the gates are shaped
  against them.** (a) `jq` libc shape: `npm view` reports `libc` as an array
  (`["glibc"]`) while the table stores a bare string, and darwin/win32 rows
  have no `libc` at all — a naive compare is always-true or always-false, so
  the workflow normalizes both sides before deep equality. (b) Cross-arch
  smoke: the smoke only proves anything on the lane's own native runner;
  each matrix row maps target→runner (arm64 lanes use an ARM runner). (c)
  `--allow-env`: `VERSION` arrives via the environment, and `deno run` is
  deny-by-default, so a dropped flag fails at tag time, not at PR time.
- **No static token exists anywhere.** Publishing is OIDC-only.

## When to Apply

- **Apply:** any compiled CLI (Rust, Go, C) distributed as an npm `bin` to
  heterogeneous consumers — especially when you want `npm i -g` / `npx` to
  just work, you have native CI runners per platform, and the npm org supports
  trusted publishing.
- **Avoid when:** single-platform or single-arch tooling (one package with
  `files`, no matrix); N-API addons (in-process bindings via `process.dlopen`
  are a different architecture — no launcher spawn, no platform shim); a
  binary that must be compiled on the consumer machine (postinstall builds
  are their own failure mode).
- **Trust prerequisites:** OIDC trusted publishing is a hard dependency of
  the no-token story, and the npm org needs one trusted-publisher record per
  package name; brand-new names may require a seed publish before the record
  can be configured (`docs/publishing/first-release-checklist.md`).

## Examples

`npm/packages/comment-checker/src/platform.ts` — the platform surface is two
pure helpers:

```ts
export const binaryFileName = (platform: string): string =>
  platform === "win32" ? "comment-checker.exe" : "comment-checker"

export const optionalDepName = (platform: string, arch: string): string =>
  `@systemfsoftware/claude-code-comment-checker-${platform}-${arch}`
```

`scripts/lib/targets.json` — the table is the platform contract; every
entry carries `os`/`cpu`/`libc` consumed by manifest generation, the
workflow's binary-name resolution, and the registry gate:

```json
{
  "target": "x86_64-unknown-linux-gnu",
  "suffix": "linux-x64",
  "os": "linux",
  "cpu": "x64",
  "libc": "glibc",
  "bin": "comment-checker"
}
```

`scripts/lib/sync-root-version.ts` — the inject-at-publish move that
keeps the committed manifest frozen-install-clean while the published root is
fully pinned:

```ts
manifest.optionalDependencies = Object.fromEntries(
  targets.map((entry) => [`${manifest.name}-${entry.suffix}`, version]),
)
```

`scripts/tools/check-matrix.ts` — the product policy the table must name:

```ts
const EXPECTED_SUFFIXES = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64']
```

`.github/workflows/release.yml` — version comes only from the tag, and the
tag commit must be an ancestor of the default branch before anything
publishes:

```yaml
- name: "Tag gate: derive VERSION from tag"
  run: |
    VERSION="${GITHUB_REF#refs/tags/v}"
    if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
      echo "invalid tag semver: '$VERSION'" >&2
      exit 1
    fi
    echo "VERSION=$VERSION" >> "$GITHUB_ENV"
```

The binary-sha cross-check records a sha256 sidecar per lane at build time,
then re-packs the published tarball from the registry and recomputes the
digest — the gate that catches a wrong or swapped binary being published.

## Related

- Pipeline: `.github/workflows/release.yml`
- Platform table: `scripts/lib/targets.json`
- Scripts: `scripts/tools/generate-platform-manifest.ts`,
  `scripts/lib/sync-root-version.ts`, `scripts/tools/check-matrix.ts`
- Human gate: `docs/publishing/first-release-checklist.md`
- pnpm#3960 — the constraint that makes listing optional deps a
  frozen-lockfile landmine
- Residual advisories (open GitHub issues on this repo): #3 force-pushed tag
  gate; #4 platform peerDependencies cross-link; #5 concurrency group vs
  force-moved tags; #6 smoke exit-code contract; #7 sha sidecar self-trust;
  #8 check-matrix regex-scrape fragility; #9 no actionlint / workflow YAML
  validation in CI