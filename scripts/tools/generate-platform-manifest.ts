#!/usr/bin/env -S deno run --allow-read --allow-write
import { join } from '@std/path'
import { parseCliArgs } from '../lib/cli.ts'
import { buildPlatformManifest } from '../lib/platform-manifest.ts'
import {
  LAUNCHER_MANIFEST_PATH,
  type LauncherManifest,
  type Target,
  TARGETS_PATH,
} from '../lib/shared.ts'

const TARGETS: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
const LAUNCHER: LauncherManifest = JSON.parse(await Deno.readTextFile(LAUNCHER_MANIFEST_PATH))

const args = parseCliArgs({
  alias: { 'binary-sha256': 'binarySha256', 'dry-run': 'dryRun' },
  boolean: ['dry-run'],
  string: ['suffix', 'version', 'out', 'binary-sha256'],
})

for (const flag of ['suffix', 'version', 'out'] as const) {
  if (typeof args[flag] !== 'string') {
    console.error(`generate-platform-manifest: missing required --${flag}`)
    Deno.exit(1)
  }
}
const suffix = args.suffix as string
const version = args.version as string
const out = args.out as string
const binarySha256 = args.binarySha256

const entry = TARGETS.find((t) => t.suffix === suffix)
if (!entry) {
  console.error(
    `generate-platform-manifest: unknown suffix "${suffix}"; supported suffixes: ${
      TARGETS.map((t) => t.suffix).join(', ')
    }`,
  )
  Deno.exit(1)
}

const pkg = buildPlatformManifest(LAUNCHER, entry, version, binarySha256)
const output = JSON.stringify(pkg, null, 2) + '\n'

if (args.dryRun) {
  await Deno.stdout.write(new TextEncoder().encode(output))
} else {
  await Deno.mkdir(out, { recursive: true })
  await Deno.writeTextFile(join(out, 'package.json'), output)
}
