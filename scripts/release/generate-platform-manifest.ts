#!/usr/bin/env -S deno run --allow-read --allow-write
import { parseArgs } from '@std/cli/parse-args'
import { join } from '@std/path'

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
const args = parseArgs(Deno.args, {
  alias: { 'binary-sha256': 'binarySha256', 'dry-run': 'dryRun' },
  boolean: ['dry-run'],
  string: ['suffix', 'version', 'out', 'binary-sha256'],
  unknown: (arg) => {
    console.error(`unknown argument: ${arg}`)
    Deno.exit(1)
  },
})
// std parses a string flag given without a value as "" (the --flag=value form
// still accepts values starting with "-"); reject it here, as the former
// parser did at parse time.
for (
  const [flag, key] of [
    ['suffix', 'suffix'],
    ['version', 'version'],
    ['out', 'out'],
    ['binary-sha256', 'binarySha256'],
  ] as const
) {
  if (args[key] === '') {
    console.error(`missing value for --${flag}`)
    Deno.exit(1)
  }
}
if (args._.length > 0) {
  console.error(`unknown argument: ${args._[0]}`)
  Deno.exit(1)
}

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
  // No `bin` field on platform packages (esbuild precedent): installing one
  // would create a top-level `comment-checker` shim that collides with the
  // launcher's own bin of the same name.
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
