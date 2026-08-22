#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

const MANIFEST = 'npm/packages/comment-checker/package.json'
const CHANGELOG = 'npm/packages/comment-checker/CHANGELOG.md'
const RANK: Record<string, number> = { patch: 1, minor: 2, major: 3 }

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
const manifest = JSON.parse(await Deno.readTextFile(MANIFEST))
const version = manifest.version as string
const next = nextVersion(version, bump)

manifest.version = next
await Deno.writeTextFile(
  MANIFEST,
  `${JSON.stringify(manifest, null, 2).trimEnd()}\n`,
)

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
