#!/usr/bin/env -S deno run --allow-run --allow-read --allow-env

import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const version = Deno.env.get('VERSION')
if (!version) {
  console.error('VERSION environment variable required')
  Deno.exit(1)
}

const launcherName = '@systemfsoftware/claude-code-comment-checker'
const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))

for (const target of targets) {
  const pkg = `${launcherName}-${target.suffix}`
  const cmd = new Deno.Command('npm', {
    args: [
      'view',
      `${pkg}@${version}`,
      'version',
      'os',
      'cpu',
      'libc',
      'peerDependencies',
      '--json',
    ],
    stdout: 'piped',
    stderr: 'piped',
  })
  const res = await cmd.output()
  if (!res.success) {
    console.error(`platform package ${pkg}@${version} missing from npm`)
    Deno.exit(1)
  }

  const meta = JSON.parse(new TextDecoder().decode(res.stdout))
  if (meta.version !== version) {
    console.error(`version mismatch for ${pkg}: got ${meta.version}, expected ${version}`)
    Deno.exit(1)
  }

  const expectedOs = [target.os]
  const expectedCpu = [target.cpu]
  const actualOs = Array.isArray(meta.os) ? meta.os : [meta.os]
  const actualCpu = Array.isArray(meta.cpu) ? meta.cpu : [meta.cpu]

  if (
    JSON.stringify(actualOs) !== JSON.stringify(expectedOs) ||
    JSON.stringify(actualCpu) !== JSON.stringify(expectedCpu)
  ) {
    console.error(`os/cpu mismatch for ${pkg}`)
    Deno.exit(1)
  }

  if (target.libc) {
    const actualLibc = Array.isArray(meta.libc) ? meta.libc : [meta.libc]
    if (JSON.stringify(actualLibc) !== JSON.stringify([target.libc])) {
      console.error(
        `libc mismatch for ${pkg}: got ${JSON.stringify(actualLibc)}, expected [${target.libc}]`,
      )
      Deno.exit(1)
    }
  }

  const peerVersion = meta.peerDependencies?.[launcherName]
  if (peerVersion !== version) {
    console.error(`peerDependencies mismatch for ${pkg}: got ${peerVersion}, expected ${version}`)
    Deno.exit(1)
  }

  console.log(`${target.suffix} ok`)
}
