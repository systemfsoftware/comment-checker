#!/usr/bin/env -S deno run --allow-read --allow-write
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

interface Options {
  suffix?: string
  version?: string
  out?: string
  binarySha256?: string
  dryRun: boolean
}

// CLI: --suffix <suffix> --version <version> --out <dir> [--binary-sha256 <hex>] [--dry-run]
const args = Deno.args
const opts: Options = { dryRun: false }
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--dry-run') {
    opts.dryRun = true
  } else if (
    arg === '--suffix' || arg === '--version' || arg === '--out' || arg === '--binary-sha256'
  ) {
    const value = args[++i]
    if (value === undefined) {
      console.error(`generate-platform-manifest: missing value for ${arg}`)
      Deno.exit(1)
    }
    opts[
      arg === '--binary-sha256' ? 'binarySha256' : arg.slice(2) as 'suffix' | 'version' | 'out'
    ] = value
  } else {
    console.error(`generate-platform-manifest: unknown argument: ${arg}`)
    Deno.exit(1)
  }
}

for (const flag of ['suffix', 'version', 'out'] as const) {
  if (opts[flag] === undefined) {
    console.error(`generate-platform-manifest: missing required --${flag}`)
    Deno.exit(1)
  }
}

const entry = TARGETS.find((t) => t.suffix === opts.suffix)
if (!entry) {
  console.error(
    `generate-platform-manifest: unknown suffix "${opts.suffix}"; supported suffixes: ${
      TARGETS.map((t) => t.suffix).join(', ')
    }`,
  )
  Deno.exit(1)
}

const pkg: Record<string, unknown> = {
  name: `${LAUNCHER.name}-${entry.suffix}`,
  version: opts.version,
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
if (opts.binarySha256 !== undefined) {
  pkg.binarySha256 = opts.binarySha256
}

const output = JSON.stringify(pkg, null, 2) + '\n'

if (opts.dryRun) {
  await Deno.stdout.write(new TextEncoder().encode(output))
} else {
  await Deno.mkdir(opts.out!, { recursive: true })
  await Deno.writeTextFile(join(opts.out!, 'package.json'), output)
}
