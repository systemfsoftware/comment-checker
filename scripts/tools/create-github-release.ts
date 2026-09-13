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

const digests: Record<string, string> = {}
for (const t of targets) {
  const exe = t.bin.endsWith('.exe')
  const shipped = `release-assets/binaries/comment-checker-${t.target}${exe ? '.exe' : ''}`
  const bytes = await Deno.readFile(shipped)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  const staged = `stages/platform-stage-${t.suffix}/binarySha256`
  const expected = (await Deno.readTextFile(staged)).trim()
  if (hex !== expected) {
    console.error(`create-github-release: ${t.target} shipped ${hex} but staged ${expected}`)
    Deno.exit(1)
  }
  digests[t.target] = hex
}

const NIX_CPU: Record<string, string> = { x64: 'x86_64', arm64: 'aarch64' }
const systems: Record<string, string> = {}
for (const t of targets) {
  if (t.os === 'win32') continue
  systems[`${NIX_CPU[t.cpu] ?? t.cpu}-${t.os}`] = t.target
}

const manifestPath = 'nix/release-hashes.json'
const branch = `nix-release-hashes-v${version}`

await Deno.mkdir('nix', { recursive: true })
await Deno.writeTextFile(
  manifestPath,
  JSON.stringify({ version, assets: digests, systems }, null, 2) + '\n',
)

if ((await exec('git', ['status', '--porcelain', '--', manifestPath])).trim() === '') {
  console.log(`${manifestPath} already pins v${version}`)
} else {
  await exec('git', ['config', 'user.name', 'github-actions[bot]'])
  await exec('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  // The husky hooks this job installed must not gate a generated file.
  await exec('git', ['checkout', '-b', branch])
  await exec('git', ['add', '--', manifestPath])
  await exec('git', ['commit', '--no-verify', '-m', `chore(release): pin nix release hashes for v${version}`])
  await exec('git', ['push', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`])
  const pr = (await exec('gh', [
    'pr',
    'create',
    '--base',
    'master',
    '--head',
    branch,
    '--title',
    `chore(release): pin nix release hashes for v${version}`,
    '--body',
    `Generated by the release pipeline from the v${version} assets: \`${manifestPath}\` carries the version and the SHA-256 of every uploaded binary, and the derivation that consumes it names both, so neither can drift from the other.`,
  ])).trim()
  const armed = await exec('gh', ['pr', 'merge', pr, '--squash', '--auto'])
    .then(() => true)
    .catch(() => false)
  console.log(`${pr}${armed ? ' (auto-merge armed)' : ' (merge by hand)'}`)
}
