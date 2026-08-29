#!/usr/bin/env -S deno run --allow-run=git,gh --allow-read --allow-write --allow-env

// Keep flake.nix release-asset hashes in sync with the binaries just published.
// Runs in the release.yml publish job after create-github-release.ts, which
// extracts the raw binaries into release-assets/binaries/.
//
// Nix fixed-output derivations cache by name + declared hash: bumping the
// version string alone never invalidates the fetchurl store path, so a flake
// whose hashes lag the published assets serves stale bytes (or fails cold
// stores). This script rewrites the four SRI values to the just-built bytes
// and opens a PR, so consumers always fetch the binary the version claims.
//
// DRY_RUN=1 prints the would-be PR without mutating anything.

import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const MANIFEST = 'npm/packages/comment-checker/package.json'
const FLAKE = 'flake.nix'
const BRANCH_PREFIX = 'fix/flake-hashes-'
const BASE = 'master'

async function exec(cmd: string, args: string[], allowFail = false): Promise<string> {
  const out = await new Deno.Command(cmd, {
    args,
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (!out.success && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed`)
  }
  return new TextDecoder().decode(out.stdout).trim()
}

async function sha256Sri(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const raw = new Uint8Array(digest)
  return `sha256-${btoa(String.fromCharCode(...raw))}`
}

function rewriteFlakeHashes(text: string, srIs: Map<string, string>): string {
  let out = text
  for (const [triple, sri] of srIs) {
    const pattern = new RegExp(`("${triple}"\\s*=\\s*)"sha256-[A-Za-z0-9+/=]+"`)
    const match = pattern.exec(out)
    if (!match) {
      throw new Error(`flake.nix: no hash entry for ${triple}`)
    }
    out = out.slice(0, match.index) + match[1] + `"${sri}"` + out.slice(match.index + match[0].length)
  }
  return out
}

const launcherManifest = JSON.parse(await Deno.readTextFile(MANIFEST))
const version = launcherManifest.version as string
const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
// The flake hash block has one key per unix triple; the windows row has no
// key there and must not enter the set.
const unixTargets = targets.filter((t) => t.os !== 'win32')

const binaries: { target: Target; sri: string }[] = []
for (const t of unixTargets) {
  const p = `release-assets/binaries/comment-checker-${t.target}`
  let bytes: Uint8Array
  try {
    bytes = await Deno.readFile(p)
  } catch {
    throw new Error(`sync-flake-hashes: missing binary for ${t.target} at ${p} — create-github-release.ts must have run first`)
  }
  binaries.push({ target: t, sri: await sha256Sri(bytes) })
}

const nextSrIs = new Map(binaries.map((b) => [b.target.target, b.sri]))
const flakeText = await Deno.readTextFile(FLAKE)
const rewritten = rewriteFlakeHashes(flakeText, nextSrIs)
const changed = rewritten !== flakeText

if (!changed) {
  console.log(`sync-flake-hashes: flake.nix hashes already match v${version} — nothing to do`)
  Deno.exit(0)
}

const branch = `${BRANCH_PREFIX}v${version}`
const dryRun = Deno.env.get('DRY_RUN') === '1'

if (dryRun) {
  console.log(`sync-flake-hashes [dry-run]: would open ${branch} updating flake.nix to v${version}`)
  for (const b of binaries) {
    console.log(`  ${b.target.target} -> ${b.sri}`)
  }
  Deno.exit(0)
}

await Deno.writeTextFile(FLAKE, rewritten)

// Round-trip: the rewrite must be byte-exact for every SRI (CHK1 — never
// trust the version field alone; re-read the file and compare).
const after = await Deno.readTextFile(FLAKE)
for (const b of binaries) {
  if (!after.includes(`"${b.target.target}" = "${b.sri}"`)) {
    throw new Error(`sync-flake-hashes: hash rewrite did not round-trip for ${b.target.target}`)
  }
}

await exec('git', ['config', 'user.name', 'github-actions[bot]'])
await exec('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
await exec('git', ['switch', '--force-create', branch])
await exec('git', ['add', '--', FLAKE])
await exec('git', ['commit', '-m', `fix(flake): sync v${version} release asset hashes`])
await exec('git', ['push', '--force', 'origin', branch])

const prBody =
  `Refreshes the \`flake.nix\` \`fetchurl\` SRI set to the v${version} release assets. ` +
  'Nix fixed-output derivations cache by name + declared hash, so the version-string bump alone never invalidates ' +
  'the fetched bytes; these hashes are what make `nix build .#comment-checker` serve the binary this release published.'

await exec('gh', [
  'pr',
  'create',
  '--base',
  BASE,
  '--head',
  branch,
  '--title',
  `fix(flake): sync v${version} release asset hashes`,
  '--body',
  prBody,
])
console.log(`sync-flake-hashes: opened PR for ${branch}`)

// Bound the broken-window: from tag creation until this PR merges, a fresh
// nix build of master fails (declared version + old hashes). Auto-merge lands
// it as soon as CI passes when branch protection permits bot auto-merge.
const prNumber = await exec('gh', [
  'pr',
  'list',
  '--head',
  branch,
  '--state',
  'open',
  '--json',
  'number',
  '--jq',
  '.[0].number // empty',
])
if (prNumber) {
  await exec('gh', ['pr', 'merge', '--auto', '--squash', prNumber], true)
}