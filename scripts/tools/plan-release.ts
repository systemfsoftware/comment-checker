#!/usr/bin/env -S deno run --allow-read --allow-run=git

// Decide which release phase this push is, from repository state alone.
//
// The publish used to hang off `pull_request: closed` for the release PR.
// Merging that PR with branch deletion destroys `refs/pull/<n>/merge`, so
// GitHub cancelled the queued run with zero jobs and nothing ever published --
// the trigger was destroyed by the act of merging. State is durable where a
// PR ref is not: pending intents mean "version", an untagged version means
// "publish". Re-running any push to master resumes a half-finished release.

import { LAUNCHER_MANIFEST_PATH } from '../lib/shared.ts'

async function gitTagExists(tag: string): Promise<boolean> {
  const out = await new Deno.Command('git', {
    args: ['tag', '--list', tag],
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return new TextDecoder().decode(out.stdout).trim() !== ''
}

async function pendingIntents(): Promise<string[]> {
  const names: string[] = []
  try {
    for await (const entry of Deno.readDir('.changeset')) {
      if (entry.isFile && entry.name.endsWith('.md') && entry.name !== 'README.md') {
        names.push(entry.name)
      }
    }
  } catch {
    // no .changeset directory: nothing pending
  }
  return names
}

const manifest = JSON.parse(await Deno.readTextFile(LAUNCHER_MANIFEST_PATH))
const version = manifest.version as string
const tag = `v${version}`

const pending = await pendingIntents()
const tagged = await gitTagExists(tag)

const phase = pending.length > 0 ? 'version' : tagged ? 'none' : 'publish'

// Diagnostics on stderr; stdout carries only key=value for GITHUB_OUTPUT.
console.error(
  `plan-release: version=${version} tag=${tag} tagged=${tagged} pending=${pending.length}` +
    (pending.length > 0 ? ` (${pending.join(', ')})` : '') +
    ` -> phase=${phase}`,
)
if (phase === 'none') {
  console.error(`plan-release: ${tag} already released; nothing to do`)
}

console.log(`phase=${phase}`)
console.log(`version=${version}`)
