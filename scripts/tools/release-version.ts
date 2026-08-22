#!/usr/bin/env -S deno run --allow-read=. --allow-write=. --allow-env=GITHUB_TOKEN,GITHUB_REPOSITORY --allow-run=git

const MANIFEST = 'npm/packages/comment-checker/package.json'
const CHANGELOG = 'npm/packages/comment-checker/CHANGELOG.md'
const RANK: Record<string, number> = { patch: 1, minor: 2, major: 3 }

type Intent = { path: string; bump: string; summary: string }

async function git(...args: string[]): Promise<void> {
  const r = await new Deno.Command('git', {
    args,
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (!r.success) throw new Error(`git ${args[0]} failed`)
}

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

async function gitReady(): Promise<void> {
  await git('config', 'user.name', 'github-actions[bot]')
  await git(
    'config',
    'user.email',
    '41898282+github-actions[bot]@users.noreply.github.com',
  )
  const repository = Deno.env.get('GITHUB_REPOSITORY')
  const token = Deno.env.get('GITHUB_TOKEN')
  if (repository && token) {
    await git(
      'remote',
      'set-url',
      'origin',
      `https://x-access-token:${token}@github.com/${repository}.git`,
    )
  }
}

const pending: string[] = []
for await (const entry of Deno.readDir('./.changeset')) {
  if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
    pending.push(entry.name)
  }
}
if (pending.length === 0) {
  console.log('no change intents; nothing to release')
  Deno.exit(0)
}

await gitReady()
const intents = await Promise.all(
  pending.map((name) => parseIntent(`.changeset/${name}`)),
)
const releases = intents.filter((i) => i.bump !== 'none')
if (releases.length === 0) {
  for (const i of intents) await Deno.remove(i.path)
  await git('add', '-A', '.changeset')
  await git('commit', '-m', 'chore: consume change intent (no release)')
  await git('push', 'origin', 'master')
  console.log('no release bump requested; intents consumed')
  Deno.exit(0)
}

const bump = releases.sort((a, b) => RANK[b.bump] - RANK[a.bump])[0].bump
const summary = releases.map((i) => `  - ${i.summary}`).join('\n')
const version = JSON.parse(await Deno.readTextFile(MANIFEST)).version as string
const next = nextVersion(version, bump)

const manifest = JSON.parse(await Deno.readTextFile(MANIFEST))
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
await git('add', MANIFEST, CHANGELOG, '.changeset')
await git('commit', '-m', `chore: release ${next}`)

await git('push', 'origin', 'master')
await git('tag', '-a', `v${next}`, '-m', `release v${next}`)
await git('push', 'origin', `v${next}`)
console.log(`released v${next}; release pipeline will publish`)
