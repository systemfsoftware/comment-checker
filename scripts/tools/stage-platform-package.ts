#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { parseArgs } from '@std/cli/parse-args'
import { join } from '@std/path'
import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const flags = parseArgs(Deno.args, {
  string: ['target', 'suffix', 'stage', 'bin-dir'],
})

const targetName = flags.target
const suffix = flags.suffix
const stage = flags.stage
const binDir = flags['bin-dir']

if (!targetName || !suffix || !stage || !binDir) {
  console.error(
    'Usage: stage-platform-package.ts --target <target> --suffix <suffix> --stage <dir> --bin-dir <dir>',
  )
  Deno.exit(1)
}

const launcherManifest = JSON.parse(
  await Deno.readTextFile('npm/packages/comment-checker/package.json'),
)
const version = launcherManifest.version as string

const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
const row = targets.find((t) => t.target === targetName && t.suffix === suffix)
if (!row) {
  console.error(`target ${targetName} / suffix ${suffix} missing from targets.json`)
  Deno.exit(1)
}

await Deno.mkdir(stage, { recursive: true })

const srcBin = join(binDir, row.bin)
const dstBin = join(stage, row.bin)
await Deno.copyFile(srcBin, dstBin)

const bytes = await Deno.readFile(dstBin)
const digestBuf = await crypto.subtle.digest('SHA-256', bytes)
const hex = Array.from(new Uint8Array(digestBuf))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('')

const manifest = {
  name: `@systemfsoftware/claude-code-comment-checker-${suffix}`,
  version,
  description:
    `Platform binary for @systemfsoftware/claude-code-comment-checker on ${row.os}-${row.cpu}`,
  license: 'Apache-2.0',
  repository: {
    type: 'git',
    url: 'git+https://github.com/systemfsoftware/comment-checker.git',
  },
  os: [row.os],
  cpu: [row.cpu],
  ...(row.libc ? { libc: [row.libc] } : {}),
  bin: {
    'comment-checker': row.bin,
  },
  files: [row.bin],
  binarySha256: hex,
  peerDependencies: {
    '@systemfsoftware/claude-code-comment-checker': version,
  },
}

await Deno.writeTextFile(
  join(stage, 'package.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)

await Deno.writeTextFile(
  join(stage, 'binarySha256'),
  hex + '\n',
)

console.log(`staged ${manifest.name}@${version} (sha: ${hex})`)
