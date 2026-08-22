#!/usr/bin/env -S deno run --allow-run=git,gh --allow-read --allow-env

import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const MANIFEST = 'npm/packages/comment-checker/package.json'
const CHANGELOG = 'npm/packages/comment-checker/CHANGELOG.md'

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

let releaseNotes = `Release v${version}`
try {
  const changelogText = await Deno.readTextFile(CHANGELOG)
  const versionSection = changelogText.split(new RegExp(`##\\s+${version.replace(/\./g, '\\.')}`))
    ?.[1]
  if (versionSection) {
    const sectionBody = versionSection.split(/\n##\s+/)?.[0]?.trim()
    if (sectionBody) {
      releaseNotes = sectionBody
    }
  }
} catch {
  // empty
}

const binaryFiles: string[] = []
for (const target of targets) {
  const tarName = `release-assets/release-${target.suffix}/comment-checker-${target.target}.tar.gz`
  try {
    const stat = await Deno.stat(tarName)
    if (stat.isFile) {
      binaryFiles.push(tarName)
    }
  } catch {
    const flatName = `release-assets/comment-checker-${target.target}.tar.gz`
    try {
      const statFlat = await Deno.stat(flatName)
      if (statFlat.isFile) {
        binaryFiles.push(flatName)
      }
    } catch {
      // ignore
    }
  }
}

const tag = `v${version}`
const ghArgs = [
  'release',
  'create',
  tag,
  ...binaryFiles,
  '--title',
  tag,
  '--notes',
  releaseNotes,
]

await exec('gh', ghArgs)
console.log(
  `created GitHub release ${tag} with ${binaryFiles.length} binary tarball(s) and changelog notes`,
)
