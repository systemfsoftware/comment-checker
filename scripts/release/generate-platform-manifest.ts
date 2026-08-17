#!/usr/bin/env -S deno run --allow-read --allow-write
import { join } from '@std/path'
import { parseFlags } from './args.ts'

const ROOT = join(import.meta.dirname!, '..', '..')

interface Target {
  target: string
  suffix: string
  os: string
  cpu: string
  libc?: string
  bin: string
}

const TARGETS: Target[] = JSON.parse(
  await Deno.readTextFile(join(ROOT, 'scripts', 'release', 'targets.json')),
)
const LAUNCHER: { name: string; repository: { type: string; url: string } } = JSON.parse(
  await Deno.readTextFile(join(ROOT, 'npm', 'packages', 'comment-checker', 'package.json')),
)

// CLI: --suffix <suffix> --version <version> --out <dir> [--binary-sha256 <hex>] [--dry-run]
const args = parseFlags(Deno.args, {
  string: ['suffix', 'version', 'out', 'binary-sha256'],
  boolean: ['dry-run'],
  rename: { 'binary-sha256': 'binarySha256', 'dry-run': 'dryRun' },
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
  bin: { 'comment-checker': `./${entry.bin}` },
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
