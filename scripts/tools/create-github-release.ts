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
  const candidates = [
    // download-artifact with pattern release-* preserves the uploaded path:
    //   dist/release-tarball-<suffix>/comment-checker-<target>.tar.gz
    // inside release-assets/release-<suffix>/, so the real file is:
    `release-assets/release-${target.suffix}/dist/release-tarball-${target.suffix}/comment-checker-${target.target}.tar.gz`,
    // legacy / flat fallbacks (never hide a missing tarball as 0-bin release)
    `release-assets/release-${target.suffix}/comment-checker-${target.target}.tar.gz`,
    `release-assets/comment-checker-${target.target}.tar.gz`,
  ]
  let found: string | null = null
  for (const p of candidates) {
    try {
      const stat = await Deno.stat(p)
      if (stat.isFile) {
        found = p
        break
      }
    } catch {
      // try next candidate
    }
  }
  if (found) {
    binaryFiles.push(found)
  } else {
    console.error(`create-github-release: missing tarball for ${target.target} (tried ${candidates.join(', ')})`)
  }
}
if (binaryFiles.length === 0) {
  console.error('create-github-release: no binary tarballs found — refusing to create an empty release')
  Deno.exit(1)
}
if (binaryFiles.length !== targets.length) {
  console.error(`create-github-release: expected ${targets.length} tarballs, found ${binaryFiles.length}`)
  Deno.exit(1)
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
