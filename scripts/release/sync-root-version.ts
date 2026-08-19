#!/usr/bin/env -S deno run --allow-read --allow-write
import { resolve } from '@std/path'
import { parseCliArgs } from './cli.ts'
import { LAUNCHER_MANIFEST_PATH, type LauncherManifest, type Target, TARGETS_PATH } from './shared.ts'

const VERSION_RE = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/

// Validated before any write. `$` matches before a trailing newline, so reject
// one explicitly.
const version = Deno.env.get('VERSION') ?? ''
if (!VERSION_RE.test(version) || version.includes('\n')) {
  console.error(`sync-root-version: invalid VERSION: ${JSON.stringify(version)}`)
  Deno.exit(1)
}

const flags = parseCliArgs({
  alias: { 'dry-run': 'dryRun', 'manifest-path': 'manifestPath' },
  boolean: ['dry-run'],
  string: ['manifest-path'],
})
const dryRun = flags.dryRun === true
const manifestPath = typeof flags.manifestPath === 'string' ? resolve(flags.manifestPath) : LAUNCHER_MANIFEST_PATH

const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
if (!Array.isArray(targets) || targets.length !== 5) {
  console.error('sync-root-version: targets.json must declare exactly five platform targets')
  Deno.exit(1)
}

const original = await Deno.readTextFile(manifestPath)
const manifest: LauncherManifest = JSON.parse(original)
manifest.version = version
// The committed manifest carries no optionalDependencies — pnpm cannot lock
// unpublished platform packages — so inject the pins at publish time, when they exist.
manifest.optionalDependencies = Object.fromEntries(
  targets.map((entry) => [`${manifest.name}-${entry.suffix}`, version]),
)

// An unchanged sync must stay byte-identical: keep the file's indent and trailing newline.
const next = JSON.stringify(manifest, null, 2) + (original.endsWith('\n') ? '\n' : '')

// LCS line diff over two small JSON texts.
function diffLines(before: string, after: string): string[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`- ${a[i]}`)
      i++
    } else {
      out.push(`+ ${b[j]}`)
      j++
    }
  }
  while (i < n) {
    out.push(`- ${a[i]}`)
    i++
  }
  while (j < m) {
    out.push(`+ ${b[j]}`)
    j++
  }
  return out
}

if (dryRun) {
  for (const line of diffLines(original, next)) {
    console.log(line)
  }
} else {
  await Deno.writeTextFile(manifestPath, next)
}
