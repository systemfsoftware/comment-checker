#!/usr/bin/env -S deno run --allow-read --allow-write
import { parseArgs } from '@std/cli/parse-args'
import { join, resolve } from '@std/path'

const ROOT = join(import.meta.dirname!, '..', '..')
const DEFAULT_MANIFEST_PATH = join(ROOT, 'npm', 'packages', 'comment-checker', 'package.json')
const TARGETS_PATH = join(ROOT, 'scripts', 'release', 'targets.json')
const VERSION_RE = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/

// VERSION is validated BEFORE any write; a value that never reaches end-of-input
// (e.g. trailing line breaks) is invalid even though $ can match before one.
const version = Deno.env.get('VERSION') ?? ''
if (!VERSION_RE.test(version) || version.includes('\n')) {
  console.error(`sync-root-version: invalid VERSION: ${JSON.stringify(version)}`)
  Deno.exit(1)
}

// CLI: [--manifest-path <path>] [--dry-run]. The committed launcher manifest
// carries NO optionalDependencies (pnpm cannot record unresolvable optional
// deps in a lockfile, so listing unpublished platform packages would break
// `pnpm install --frozen-lockfile`); this script injects the five pins from
// targets.json at publish time, when the platform packages already exist.
const flags = parseArgs(Deno.args, {
  alias: { 'dry-run': 'dryRun', 'manifest-path': 'manifestPath' },
  boolean: ['dry-run'],
  string: ['manifest-path'],
  unknown: (arg) => {
    console.error(`unknown argument: ${arg}`)
    Deno.exit(1)
  },
})
// std parses a string flag given without a value as ""; reject it here, as the
// former parser did at parse time.
if (flags.manifestPath === '') {
  console.error('missing value for --manifest-path')
  Deno.exit(1)
}
if (flags._.length > 0) {
  console.error(`unknown argument: ${flags._[0]}`)
  Deno.exit(1)
}
const dryRun = flags.dryRun === true
const manifestArg = flags.manifestPath
const manifestPath = typeof manifestArg === 'string' ? resolve(manifestArg) : DEFAULT_MANIFEST_PATH

const targets = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
if (!Array.isArray(targets) || targets.length !== 5) {
  console.error('sync-root-version: targets.json must declare exactly five platform targets')
  Deno.exit(1)
}

const original = await Deno.readTextFile(manifestPath)
const manifest = JSON.parse(original)
manifest.version = version
// The published root's optionalDependencies are pinned to the tag version for
// exactly the five platform packages declared in targets.json.
manifest.optionalDependencies = Object.fromEntries(
  targets.map((entry) => [`${manifest.name}-${entry.suffix}`, version]),
)

// Preserve the launcher manifest's own formatting so an unchanged sync is a
// byte-identical round trip: 2-space indent plus the file's existing
// trailing-newline convention.
const next = JSON.stringify(manifest, null, 2) + (original.endsWith('\n') ? '\n' : '')

function diffLines(before: string, after: string): string[] {
  const a = before.split('\n')
  const b = after.split('\n')
  // LCS-based line diff over two small JSON texts.
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
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
