#!/usr/bin/env -S deno run --allow-read --allow-write
import { resolve } from '@std/path'
import { diffLines } from 'diff'
import { parseCliArgs } from './cli.ts'
import {
  LAUNCHER_MANIFEST_PATH,
  type LauncherManifest,
  type Target,
  TARGETS_PATH,
} from './shared.ts'

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
const manifestPath = typeof flags.manifestPath === 'string'
  ? resolve(flags.manifestPath)
  : LAUNCHER_MANIFEST_PATH

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

if (dryRun) {
  // jsdiff does the LCS; render only the changed lines as a - / + preview.
  for (const part of diffLines(original, next)) {
    if (!part.added && !part.removed) continue
    const marker = part.added ? '+' : '-'
    const body = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value
    for (const line of body.split('\n')) {
      console.log(`${marker} ${line}`)
    }
  }
} else {
  await Deno.writeTextFile(manifestPath, next)
}
