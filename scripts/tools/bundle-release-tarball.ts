#!/usr/bin/env -S deno run --allow-run=tar --allow-read --allow-write --allow-env

import { parseArgs } from '@std/cli/parse-args'
import { type Target, TARGETS_PATH } from '../lib/shared.ts'
import { writeReleaseTarball } from '../lib/write-release-tarball.ts'

const flags = parseArgs(Deno.args, {
  string: ['target', 'bin-dir', 'out-dir'],
})

const targetName = flags.target
const binDir = flags['bin-dir']
const outDir = flags['out-dir']

if (!targetName || !binDir || !outDir) {
  console.error(
    'Usage: bundle-release-tarball.ts --target <target> --bin-dir <dir> --out-dir <dir>',
  )
  Deno.exit(1)
}

const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
const row = targets.find((t) => t.target === targetName)
if (!row) {
  console.error(`target ${targetName} missing from targets.json`)
  Deno.exit(1)
}

try {
  const tarPath = await writeReleaseTarball(outDir, targetName, binDir, row.bin)
  console.log(`bundled ${tarPath}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  Deno.exit(1)
}
