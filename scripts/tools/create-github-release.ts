#!/usr/bin/env -S deno run --allow-run=git,gh,tar --allow-read --allow-write --allow-env

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

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  try {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory) await walk(p, out)
      else if (e.isFile) out.push(p)
    }
  } catch { /* dir missing */ }
  return out
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

const tarballs: { target: Target; tarball: string }[] = []
const missing: string[] = []
for (const t of targets) {
  const p = `release-assets/release-${t.suffix}/comment-checker-${t.target}.tar.gz`
  try {
    if ((await Deno.stat(p)).isFile) tarballs.push({ target: t, tarball: p })
    else {
      console.error(`create-github-release: missing tarball for ${t.target} at ${p}`)
      missing.push(p)
    }
  } catch {
    console.error(`create-github-release: missing tarball for ${t.target} at ${p}`)
    missing.push(p)
  }
}

if (missing.length > 0) {
  console.error(`create-github-release: expected ${targets.length} tarballs, found ${tarballs.length}`)
  const tree = await walk('release-assets')
  if (tree.length > 0) {
    console.error('release-assets tree:')
    for (const f of tree.sort()) console.error(`  ${f}`)
  } else {
    console.error('release-assets is empty or missing')
  }
  Deno.exit(1)
}

await Deno.mkdir('release-assets/binaries', { recursive: true })

const binaries = await Promise.all(tarballs.map(async ({ target, tarball }) => {
  const tmp = `release-assets/binaries/.tmp-${target.suffix}`
  await Deno.mkdir(tmp, { recursive: true })
  const res = await new Deno.Command('tar', { args: ['-xzf', tarball, '-C', tmp] }).output()
  if (!res.success) throw new Error(`tar -xzf ${tarball} failed with ${res.code}`)
  const exe = target.bin.endsWith('.exe')
  const outName = `comment-checker-${target.target}${exe ? '.exe' : ''}`
  const outPath = `release-assets/binaries/${outName}`
  await Deno.rename(`${tmp}/${target.bin}`, outPath)
  await Deno.remove(tmp, { recursive: true })
  return outPath
}))

const tag = `v${version}`
await exec('gh', ['release', 'create', tag, ...binaries, '--title', tag, '--notes', releaseNotes])
console.log(`created GitHub release ${tag} with ${binaries.length} binaries`)
