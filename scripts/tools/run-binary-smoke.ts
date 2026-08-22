#!/usr/bin/env -S deno run --allow-run --allow-read

import { parseArgs } from '@std/cli/parse-args'
import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const flags = parseArgs(Deno.args, {
  string: ['target', 'bin-dir'],
})

const targetName = flags.target
const binDir = flags['bin-dir']

if (!targetName || !binDir) {
  console.error('Usage: run-binary-smoke.ts --target <target> --bin-dir <dir>')
  Deno.exit(1)
}

const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
const row = targets.find((t) => t.target === targetName)
if (!row) {
  console.error(`target ${targetName} missing from targets.json`)
  Deno.exit(1)
}

const binPath = `${binDir}/${row.bin}`

const cleanPayload =
  '{"tool_name":"Write","tool_input":{"file_path":"src/client.py","content":"# SPDX-License-Identifier: Apache-2.0\ndef load(path):\n    return open(path).read()\n"}}'

const flaggedPayload =
  '{"tool_name":"Write","tool_input":{"file_path":"src/load_config.py","content":"def load_config(path):\n    # TODO: fix this later\n    return json.load(open(path))\n"}}'

async function runWithInput(bin: string, payload: string): Promise<number> {
  const cmd = new Deno.Command(bin, {
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  })
  const child = cmd.spawn()
  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(payload + '\n'))
  await writer.close()
  const status = await child.status
  return status.code
}

const cleanRc = await runWithInput(binPath, cleanPayload)
if (cleanRc !== 0) {
  console.error(`clean payload exited ${cleanRc}, expected 0`)
  Deno.exit(1)
}

const flaggedRc = await runWithInput(binPath, flaggedPayload)
if (flaggedRc !== 2) {
  console.error(`flagged payload exited ${flaggedRc}, expected 2`)
  Deno.exit(1)
}

console.log(`binary smoke passed for ${targetName}`)
