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
  if (!out.success) throw new Error(`${cmd} ${args.join(' ')} failed`)
  return new TextDecoder().decode(out.stdout)
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      if ((await Deno.stat(p)).isFile) return p
    } catch { /* next */ }
  }
  return null
}

const launcherManifest = JSON.parse(await Deno.readTextFile(MANIFEST))
const version = launcherManifest.version as string
const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))

let releaseNotes = `Release v${version}`
try {
  const text = await Deno.readTextFile(CHANGELOG)
  const sec = text.split(new RegExp(`##\\s+${version.replace(/\./g, '\\.')}`))?.[1]
  const body = sec?.split(/\n##\s+/)?.[0]?.trim()
  if (body) releaseNotes = body
} catch { /* no changelog */ }

const binaryFiles = (await Promise.all(targets.map((t) =>
  firstExisting([
    `release-assets/release-${t.suffix}/dist/release-tarball-${t.suffix}/comment-checker-${t.target}.tar.gz`,
    `release-assets/release-${t.suffix}/comment-checker-${t.target}.tar.gz`,
    `release-assets/comment-checker-${t.target}.tar.gz`,
  ]).then((found) => {
    if (!found) console.error(`create-github-release: missing tarball for ${t.target}`)
    return found
  })
))).filter((p): p is string => p !== null)

if (binaryFiles.length !== targets.length) {
  console.error(`create-github-release: expected ${targets.length} tarballs, found ${binaryFiles.length}`)
  Deno.exit(1)
}

const tag = `v${version}`
await exec('gh', ['release', 'create', tag, ...binaryFiles, '--title', tag, '--notes', releaseNotes])
console.log(`created GitHub release ${tag} with ${binaryFiles.length} binary tarball(s)`)
