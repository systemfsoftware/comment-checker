# First npm Publish — Bootstrap (OIDC cannot precede existence)

Run once, by a human with `systemfsoftware` npm org access, before the first
tag-triggered release. After this bootstrap, `release.yml` publishes everything
with OIDC provenance and no static tokens.

## Why this one-time step exists

npm's OIDC trusted publishing is configured **per package** on the package's
settings page, and `npm trust` has an explicit "package must exist" prerequisite:
<https://docs.npmjs.com/cli/v12/commands/npm-trust/>. First-publish via OIDC is
still not supported upstream (open issue:
<https://github.com/npm/cli/issues/8544>). So the six package names must be
claimed once with a token, then the trusted-publisher records are configured.

Measured 2026-08-19: all six names are unclaimed (`npm view` returns E404):
`@systemfsoftware/claude-code-comment-checker` and the five platform packages
(`-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`, `-win32-x64`).

## Prerequisites

- npm account, logged in, 2FA enabled, member of the `systemfsoftware` org
  with publish rights on the `@systemfsoftware` scope.
- `npm -v` >= 11.15.0 (needed for `npm trust`; `npm i -g npm@latest` if older).
- This repo checked out; commands run from the repo root.

## Publish six placeholders (dummy version)

Every generated manifest carries `publishConfig.provenance: true` (npm honors
that setting; on a laptop there is no OIDC token), so every bootstrap publish
**must** pass `--no-provenance` or npm attempts OIDC and fails.

```bash
cd /home/ryan/Documents/projects/comment-checker.worktrees/comment-checker-npm
DUMMY=0.0.0-dummy-npm            # lowest semver; the real 0.1.0 becomes "latest"

# 5 platform packages
for SUFFIX in linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64; do
  STAGE="/tmp/cc-bootstrap-$SUFFIX"
  rm -rf "$STAGE" && mkdir -p "$STAGE"
  deno run \
    --allow-read=scripts/release/targets.json,npm/packages/comment-checker/package.json \
    --allow-write="$STAGE" \
    scripts/release/generate-platform-manifest.ts \
    --suffix "$SUFFIX" --version "$DUMMY" --out "$STAGE"
  touch "$STAGE/$(jq -r '.files[0]' "$STAGE/package.json")"   # placeholder binary in tarball
  (cd "$STAGE" && npm publish --access public --no-provenance)
done

# root launcher (staged copy; repo file untouched)
ROOT_STAGE=/tmp/cc-bootstrap-root
rm -rf "$ROOT_STAGE" && mkdir -p "$ROOT_STAGE/dist"
cp npm/packages/comment-checker/package.json "$ROOT_STAGE/package.json"
touch "$ROOT_STAGE/dist/index.mjs"
VERSION="$DUMMY" deno run --allow-env \
  --allow-read=scripts/release/targets.json,"$ROOT_STAGE/package.json" \
  --allow-write="$ROOT_STAGE/package.json" \
  scripts/release/sync-root-version.ts --manifest-path "$ROOT_STAGE/package.json"
(cd "$ROOT_STAGE" && npm publish --access public --no-provenance)
```

If a publish still reports an OIDC/provenance attempt, force it off with the
environment variable `NPM_CONFIG_PROVENANCE=false` on that publish and retry.

## Configure one trusted publisher per package

CLI (first call prompts 2FA; the "skip 2FA for 5 minutes" option covers the
rest; `--file` takes the workflow **filename only**, not a path per
<https://docs.npmjs.com/trusted-publishers/>):

```bash
for PKG in \
  @systemfsoftware/claude-code-comment-checker \
  @systemfsoftware/claude-code-comment-checker-linux-x64 \
  @systemfsoftware/claude-code-comment-checker-linux-arm64 \
  @systemfsoftware/claude-code-comment-checker-darwin-x64 \
  @systemfsoftware/claude-code-comment-checker-darwin-arm64 \
  @systemfsoftware/claude-code-comment-checker-win32-x64; do
  npm trust github "$PKG" --file release.yml --repo systemfsoftware/comment-checker --allow-publish -y
  sleep 2
done

npm trust list @systemfsoftware/claude-code-comment-checker   # sanity check
```

Web form (equivalent, per package): npmjs.com -> package -> Settings ->
Trusted publishing -> GitHub Actions -> org `systemfsoftware`, repo
`comment-checker`, workflow file `release.yml`, allowed action `npm publish`.

## First real release (provenance on all six)

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`release.yml` then builds and gates, publishes the five platform packages with
`--provenance`, cross-checks published sha256 against the recorded sidecars,
syncs the root version + optionalDependencies pins from the tag, publishes the
root, and verifies the pins. All auth via OIDC.

## Cleanup and don'ts

- After 0.1.0 lands, the placeholders can be deprecated:

  ```bash
  for PKG in @systemfsoftware/claude-code-comment-checker{,-linux-x64,-linux-arm64,-darwin-x64,-darwin-arm64,-win32-x64}; do
    npm deprecate "$PKG@$DUMMY" "placeholder used to bootstrap OIDC trusted publishing"
  done
  ```

- Do **not** `npm unpublish` a placeholder: deleting the only version deletes
  the package and its trusted-publisher config, breaking OIDC. Deprecation
  keeps name, config, and provenance trail intact.