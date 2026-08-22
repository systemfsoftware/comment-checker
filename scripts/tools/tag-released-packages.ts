#!/usr/bin/env -S deno run --allow-run=git --allow-read

import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const MANIFEST = 'npm/packages/comment-checker/package.json'

async function exec(cmd: string, args: string[]): Promise<string> {
  const out = await new Deno.Command(cmd, {
    args,
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (!out.success) {
    throw new Error(`${cmd} ${args.join(' ')} failed`)
  }
  return new TextDecoder().decode(out.stdout)
}

const launcherManifest = JSON.parse(await Deno.readTextFile(MANIFEST))
const version = launcherManifest.version as string
const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))

const remoteTags = new Set(
  (await exec('git', ['ls-remote', '--tags', 'origin']))
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/.*refs\/tags\//, '').replace(/\^\{\}$/, '')),
)

const tagsToMake: string[] = []

const rootTag = `v${version}`
if (!remoteTags.has(rootTag)) {
  await exec('git', ['tag', rootTag])
  tagsToMake.push(rootTag)
}

for (const target of targets) {
  const platformTag = `@systemfsoftware/claude-code-comment-checker-${target.suffix}@v${version}`
  if (!remoteTags.has(platformTag)) {
    await exec('git', ['tag', platformTag])
    tagsToMake.push(platformTag)
  }
}

if (tagsToMake.length > 0) {
  await exec('git', ['push', 'origin', ...tagsToMake.map((t) => `refs/tags/${t}`)])
  console.log(`pushed ${tagsToMake.length} tag(s): ${tagsToMake.join(', ')}`)
} else {
  console.log('no new tags to push')
}
