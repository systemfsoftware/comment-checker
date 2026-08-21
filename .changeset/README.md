# Changesets

This directory holds change-intent files consumed by pnpm-native workspace
versioning (`pnpm version -r`). One file per change, authored with:

```bash
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A PR that changes a publishable package (`npm/packages/comment-checker`) MUST ship with
  an intent here.
- `--bump none` records a change that needs no release (e.g. devDependency or script touch).
- Intents are consumed (deleted) by `pnpm version -r` in the release workflow.
- Standard pnpm 11 native changesets format.
