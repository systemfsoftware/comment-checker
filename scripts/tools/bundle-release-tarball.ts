#!/usr/bin/env -S deno run --allow-run=tar --allow-read --allow-write --allow-env

import { parseArgs } from '@std/cli/parse-args'
import { join, resolve } from '@std/path'
import { type Target, TARGETS_PATH } from '../lib/shared.ts'

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

await Deno.mkdir(outDir, { recursive: true })
// tar runs with cwd=binDir, so the archive path must be absolute: a relative
// one would resolve against binDir instead of the invocation directory.
const tarPath = join(resolve(outDir), `comment-checker-${targetName}.tar.gz`)

const tarCmd = new Deno.Command('tar', {
  args: ['-czf', tarPath, row.bin],
  cwd: binDir,
  stdout: 'inherit',
  stderr: 'inherit',
})

const res = await tarCmd.output()
if (!res.success) {
  console.error(`tar failed with exit code ${res.code}`)
  Deno.exit(1)
}

console.log(`bundled ${tarPath}`)
