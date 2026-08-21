#!/usr/bin/env -S deno run --allow-env=VERSION --allow-read --allow-write
import { resolve } from '@std/path'
import { diff } from '@libs/diff'
import { parseCliArgs } from '../lib/cli.ts'
import {
  LAUNCHER_MANIFEST_PATH,
  type LauncherManifest,
  type Target,
  TARGETS_PATH,
} from '../lib/shared.ts'

const VERSION_RE = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/

const flags = parseCliArgs({
  alias: { 'dry-run': 'dryRun', 'manifest-path': 'manifestPath' },
  boolean: ['dry-run'],
  string: ['manifest-path', 'version'],
})
const dryRun = flags.dryRun === true
const manifestPath = typeof flags.manifestPath === 'string'
  ? resolve(flags.manifestPath)
  : LAUNCHER_MANIFEST_PATH

const original = await Deno.readTextFile(manifestPath)
const manifest: LauncherManifest = JSON.parse(original)

// Version priority: --version flag -> VERSION env var -> existing manifest.version (bumped by pnpm version)
const rawVersion = typeof flags.version === 'string'
  ? flags.version
  : (Deno.env.get('VERSION') ?? manifest.version ?? '')

if (!VERSION_RE.test(rawVersion) || rawVersion.includes('\n')) {
  console.error(`sync-root-version: invalid version: ${JSON.stringify(rawVersion)}`)
  Deno.exit(1)
}
const version = rawVersion

const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
if (!Array.isArray(targets) || targets.length !== 5) {
  console.error('sync-root-version: targets.json must declare exactly five platform targets')
  Deno.exit(1)
}

// The committed manifest carries no optionalDependencies — pnpm cannot lock
// unpublished platform packages — so inject the pins at publish time, when they exist.
manifest.optionalDependencies = Object.fromEntries(
  targets.map((entry) => [`${manifest.name}-${entry.suffix}`, version]),
)

// An unchanged sync must stay byte-identical: keep the file's indent and trailing newline.
const next = JSON.stringify(manifest, null, 2) + (original.endsWith('\n') ? '\n' : '')

if (dryRun) {
  // @libs/diff (patience algorithm) produces a real unified patch.
  console.log(diff(original, next))
} else {
  await Deno.writeTextFile(manifestPath, next)
}
