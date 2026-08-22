# Changesets

This directory holds change-intent files consumed by pnpm-native workspace
versioning (`pnpm version -r`). One file per change, authored with:

```bash
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A PR that changes a publishable package (`npm/packages/comment-checker`) MUST ship with
  an intent here.
- `--bump none` records a change that needs no release (e.g. devDependency or script touch).
- Intents are consumed by the release-versioning workflow (`release-version.yml`) on master
  push: it bumps the launcher with the intent's type, writes the CHANGELOG entry, commits,
  and tags `vX.Y.Z` — the tag is a by-product of the release. `--bump none` intents are
  consumed with no release.
- Standard pnpm 11 native changesets format.
