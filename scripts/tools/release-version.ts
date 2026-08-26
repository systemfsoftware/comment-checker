#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { type } from 'arktype'

const MANIFEST = 'npm/packages/comment-checker/package.json'
const CHANGELOG = 'npm/packages/comment-checker/CHANGELOG.md'
const WORKSPACE_CARGO = 'Cargo.toml'
const ROOT_MANIFEST = 'package.json'
const FLAKE_NIX = 'flake.nix'
const RANK: Record<string, number> = { patch: 1, minor: 2, major: 3 }

const Semver = type('string')
const isNotFound = (e: unknown): boolean =>
  e !== null && typeof e === 'object' && 'name' in e && Reflect.get(e, 'name') === 'NotFound'

function extractJsonVersion(text: string, path: string): string {
  const m = /"version"\s*:\s*"([^"]+)"/.exec(text)
  if (!m) throw new Error(`no version field in ${path}`)
  return Semver.assert(m[1])
}
function replaceJsonVersion(text: string, next: string, path: string): string {
  Semver.assert(next)
  if (!/"version"\s*:\s*"[^"]*"/.test(text)) throw new Error(`no version field in ${path}`)
  return text.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${next}"`)
}
async function bumpCargoToml(path: string, next: string): Promise<void> {
  const original = await Deno.readTextFile(path)
  const lines = original.split('\n')
  let inTarget = false
  let targetHeader: string
  if (path === WORKSPACE_CARGO) {
    targetHeader = '[workspace.package]'
  } else {
    targetHeader = '[package]'
  }
  let bumped = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('[')) {
      inTarget = trimmed === targetHeader
    } else if (inTarget && trimmed.startsWith('version')) {
      lines[i] = lines[i].replace(/version\s*=\s*"[^"]*"/, `version = "${next}"`)
      bumped = true
      break
    }
  }
  if (!bumped) {
    throw new Error(`bumpCargoToml: no version found under ${targetHeader} in ${path}`)
  }
  await Deno.writeTextFile(path, lines.join('\n'))
}

async function bumpNixVersion(path: string, next: string): Promise<void> {
  const original = await Deno.readTextFile(path)
  const lines = original.split('\n')
  let bumped = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('version = "') && !trimmed.startsWith('rust-version')) {
      if (bumped) throw new Error(`bumpNixVersion: multiple version lines in ${path}`)
      lines[i] = lines[i].replace(/version\s*=\s*"[^"]*"/, `version = "${next}"`)
      bumped = true
    }
  }
  if (!bumped) throw new Error(`bumpNixVersion: no version found in ${path}`)
  await Deno.writeTextFile(path, lines.join('\n'))
}

async function bumpJsonVersion(path: string, next: string): Promise<void> {
  const original = await Deno.readTextFile(path)
  await Deno.writeTextFile(path, replaceJsonVersion(original, next, path))
}

async function bumpPluginManifests(next: string): Promise<number> {
  let count = 0
  const candidates = ['.claude-plugin/plugin.json']
  for (const p of candidates) {
    try {
      const content = await Deno.readTextFile(p)
      await Deno.writeTextFile(p, replaceJsonVersion(content, next, p))
      count++
    } catch (e) {
      if (!isNotFound(e)) throw e
    }
  }
  return count
}
type Intent = { path: string; bump: string; summary: string }

async function parseIntent(path: string): Promise<Intent> {
  const body = await Deno.readTextFile(path)
  const parts = body.split(/^---$/m)
  const bump = /:\s*(major|minor|patch|none)/.exec(parts[1] ?? '')?.[1] ?? ''
  const summary = (parts[2] ?? '').trim().split('\n').join(' ')
  return { path, bump, summary }
}

function nextVersion(version: string, bump: string): string {
  const [major, minor, patch] = version.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const pending: string[] = []
for await (const entry of Deno.readDir('./.changeset')) {
  if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
    pending.push(entry.name)
  }
}
if (pending.length === 0) {
  console.log('no change intents; nothing to version')
  Deno.exit(0)
}

const intents = await Promise.all(
  pending.map((name) => parseIntent(`.changeset/${name}`)),
)
const releases = intents.filter((i) => i.bump !== 'none')
if (releases.length === 0) {
  for (const i of intents) await Deno.remove(i.path)
  console.log('only none intents; consumed without version bump')
  Deno.exit(0)
}

const bump = releases.sort((a, b) => RANK[b.bump] - RANK[a.bump])[0].bump
const summary = releases.map((i) => `  - ${i.summary}`).join('\n')
const manifestText = await Deno.readTextFile(MANIFEST)
const version = extractJsonVersion(manifestText, MANIFEST)
const next = nextVersion(version, bump)

await Deno.writeTextFile(MANIFEST, replaceJsonVersion(manifestText, next, MANIFEST))
await bumpCargoToml(WORKSPACE_CARGO, next)
for await (const entry of Deno.readDir('crates')) {
  if (!entry.isDirectory) continue
  const path = `crates/${entry.name}/Cargo.toml`
  try {
    await bumpCargoToml(path, next)
  } catch (e) {
    if (isNotFound(e)) continue
    throw e
  }
}
await bumpNixVersion(FLAKE_NIX, next)
await bumpJsonVersion(ROOT_MANIFEST, next)
const pluginCount = await bumpPluginManifests(next)
if (pluginCount === 0) {
  console.log('plugin manifest: none tracked — skipped')
}

let changelog = '# Changelog\n'
try {
  changelog = await Deno.readTextFile(CHANGELOG)
} catch {
  // empty
}
changelog = `${changelog.trimEnd()}\n\n## ${next}\n\n${summary}\n`
await Deno.writeTextFile(CHANGELOG, changelog)

for (const i of intents) await Deno.remove(i.path)
console.log(`versioned packages to ${next}`)
