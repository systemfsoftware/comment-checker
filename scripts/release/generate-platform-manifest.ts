#!/usr/bin/env -S deno run --allow-read --allow-write
import { join } from '@std/path'
import { parseCliArgs } from './cli.ts'
import {
  LAUNCHER_MANIFEST_PATH,
  type LauncherManifest,
  type Target,
  TARGETS_PATH,
} from './shared.ts'

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

const pkg: Record<string, unknown> = {
  name: `${LAUNCHER.name}-${entry.suffix}`,
  version,
  description: `${LAUNCHER.name} ${entry.suffix} platform package`,
  license: 'Apache-2.0',
  repository: LAUNCHER.repository,
  os: [entry.os],
  cpu: [entry.cpu],
  files: [entry.bin],
  // No bin field — a platform package's bin would collide with the launcher's
  // own comment-checker shim.
  publishConfig: { access: 'public', provenance: true },
}
if (entry.libc !== undefined) {
  pkg.libc = [entry.libc]
}
if (binarySha256 !== undefined) {
  pkg.binarySha256 = binarySha256 as string
}

const output = JSON.stringify(pkg, null, 2) + '\n'

if (args.dryRun) {
  await Deno.stdout.write(new TextEncoder().encode(output))
} else {
  await Deno.mkdir(out, { recursive: true })
  await Deno.writeTextFile(join(out, 'package.json'), output)
}
