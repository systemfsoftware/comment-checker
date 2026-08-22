#!/usr/bin/env -S deno run --allow-run=gh,git --allow-read --allow-env

const BRANCH = 'changeset-release/master'
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

const status = await exec('git', ['status', '--porcelain'])

const existingStr = await exec('gh', [
  'pr',
  'list',
  '--head',
  BRANCH,
  '--state',
  'open',
  '--json',
  'number',
  '--jq',
  '.[0].number // empty',
])
const existing = existingStr ? parseInt(existingStr, 10) : null

if (!status) {
  console.log('no pending change intents — nothing to release')
  if (existing) {
    await exec('gh', [
      'pr',
      'close',
      String(existing),
      '--delete-branch',
      '--comment',
      'No pending change intents remain.',
    ])
  }
  Deno.exit(0)
}

await exec('git', ['config', 'user.name', 'github-actions[bot]'])
await exec('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
await exec('git', ['switch', '--force-create', BRANCH])
await exec('git', ['add', '-A'])
await exec('git', ['commit', '-m', 'chore(release): version packages'])
await exec('git', ['push', '--force', 'origin', BRANCH])

const prBody = `Consumes pending \`.changeset/\` intents.

Merging publishes packages with provenance attestations and creates GitHub releases.`

await exec('gh', [
  'label',
  'create',
  'release',
  '--color',
  '0E8A16',
  '--description',
  'Automated version-packages release PR',
  '--force',
], true)

if (existing) {
  await exec('gh', [
    'pr',
    'edit',
    String(existing),
    '--title',
    'chore(release): version packages',
    '--body',
    prBody,
    '--add-label',
    'release',
  ])
  console.log(`updated release PR #${existing}`)
} else {
  await exec('gh', [
    'pr',
    'create',
    '--base',
    BASE,
    '--head',
    BRANCH,
    '--title',
    'chore(release): version packages',
    '--body',
    prBody,
    '--label',
    'release',
  ])
  console.log('created release PR')
}
