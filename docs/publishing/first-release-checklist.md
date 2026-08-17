# First npm Release Checklist

The release pipeline (`.github/workflows/release.yml`) stages everything; this
checklist is the one-time org-admin setup plus the manual verification steps
that only a human with `systemfsoftware` access can run (AGENTS.md Human
Approval Boundaries). Work through it top to bottom.

## 1. One-time org setup (npm + GitHub)

- [ ] Confirm the GitHub repo default workflow permissions are read-only
      (Settings → Actions → General → Workflow permissions → Read repository
      contents and packages permissions). The workflow declares its own
      minimal per-job grants on top.
- [ ] Create the six npm trusted-publisher entries
      (`npm access` / web form on the npm org):
      `@systemfsoftware/claude-code-comment-checker` plus the five platform
      packages (`-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`,
      `-win32-x64`). Every entry binds to:
      - Organization / Repository: `systemfsoftware` / `comment-checker`
      - Workflow Filename: `.github/workflows/release.yml`
      - Environment: `npm-release` (recommended; see note below)
      npm's trusted-publisher form has **no tag-pattern field** — the
      `refs/tags/v*` gate is enforced by the workflow's `on: push: tags`
      filter, never by the registry-side record.
- [ ] Brand-new package names: npm may require a one-time seed publish before a
      trusted-publisher record can be configured for a name that has never
      existed. If the form rejects a name, seed-publish an empty placeholder
      (`npm publish --access public` with a trivial tarball) once per name,
      then configure the record. Budget a human seed per name if needed.
- [ ] Recommended: create a GitHub Environment named `npm-release` and add
      required reviewers to the publish jobs. Deferrable — if skipped, the
      convention is exact semver tags only. If added, the environment must be
      referenced in `publish-npm-main`'s `environment:` key in release.yml.
- [ ] Confirm **no PAT** exists in any release job: only the default
      `GITHUB_TOKEN` (for uploading release assets) and `id-token: write` for
      npm OIDC provenance. Pull requests and tags must not carry secrets.

## 2. Before the tag

- [ ] `pnpm lint` and `deno task lint` green (repo gate).
- [ ] `node --test "tests/npm-launcher/*.test.mjs"` green (launcher black-box).
- [ ] `deno task test` green (release scripts; includes targets-table and
      matrix checks).
- [ ] `pnpm install --frozen-lockfile` succeeds from a fresh clone, and
      `pnpm -r build` + `pnpm -r typecheck` are green.
- [ ] `scripts/release/check-matrix.ts` passes with `.github/workflows/release.yml`
      present: `deno run --allow-read=scripts/release/targets.json,npm/packages/comment-checker/package.json,.github/workflows/release.yml scripts/release/check-matrix.ts`
- [ ] Cargo side (the release workflow runs its own build; there is no local
      build requirement, but the Rust gate is `cargo fmt --check && cargo
      clippy --all-targets -- -D warnings && cargo test --all-targets`).

## 3. Tag and watch

- [ ] Confirm the tag commit is an ancestor of the default branch (the
      workflow enforces this; also true by construction for the merge).
- [ ] `git tag v0.1.0 && git push origin v0.1.0`.
- [ ] Watch the release run: five `release-*` matrix jobs (one per target),
      `publish-npm-main`, `upload-gh-release-assets`. Each `release-*` job
      gates on check-matrix, binary existence, smoke (exit 0 clean / exit 2
      flagged), records the binary sha256 sidecar, and publishes its platform
      package with provenance.
- [ ] The run fails fast if any gate trips; the root is never published when a
      platform package is missing or its published binary sha256 differs.

## 4. Post-publish verification

- [ ] `npm view @systemfsoftware/claude-code-comment-checker@v0.1.0 version` is
      exactly `0.1.0`, and `optionalDependencies` pins all five platform
      packages at `0.1.0` exactly (never a range).
- [ ] Per suffix: `npm view @systemfsoftware/claude-code-comment-checker-<suffix>@0.1.0`
      shows `version: 0.1.0` and `os`/`cpu`/`libc` equal to
      `scripts/release/targets.json` (workflow already gates this; re-check by
      hand here).
- [ ] Provenance visible: `npm view @systemfsoftware/claude-code-comment-checker@0.1.0 provenance` (npmjs.org shows the OIDC origin).
- [ ] Fresh install on Linux (CI simulates): `pnpm dlx @systemfsoftware/claude-code-comment-checker` or `npm i -g` and run the hook binary with a clean and a flagged payload.
- [ ] Manual fresh install on macOS and on Windows (record both runs' outputs).

## 5. Sanctions and escape hatches

- [ ] Wrong binary / duplicate version recovery: npm versions are immutable —
      do **not** force-republish. Use `npm deprecate <pkg>@<version>` and ship
      the fixed binary as the next tag.
- [ ] Amending an already-published version (rolling back) is not possible;
      the tag-reachability gate prevents stray tags from publishing
      unreviewed commits, but the final guard is the human before `git push`
      of the tag.

## 6. Maintenance duty (recorded, one-off)

- [ ] The workflow pins every third-party action to a full commit SHA. Keep
      the SHA→tag mapping fresh via a dependabot `github-actions` group so
      pins are updated deliberately, never silently.

## 7. After the first release

- [ ] README: remove the "pre-release" status note under Install and keep the
      npm install command as primary.
- [ ] Record actual download counts vs the cargo-install era as the adoption
      signal (open item; not a release precondition).
- [ ] Optionally deprecate the direct GitHub tarball path once npm is proven.