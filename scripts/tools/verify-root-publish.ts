#!/usr/bin/env -S deno run --allow-run --allow-read --allow-env

import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const version = Deno.env.get('VERSION')
if (!version) {
  console.error('VERSION environment variable required')
  Deno.exit(1)
}

const launcherName = '@systemfsoftware/claude-code-comment-checker'
const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))

const cmd = new Deno.Command('npm', {
  args: ['view', `${launcherName}@${version}`, 'version', 'optionalDependencies', '--json'],
  stdout: 'piped',
  stderr: 'piped',
})
const res = await cmd.output()
if (!res.success) {
  console.error(`launcher ${launcherName}@${version} missing from npm`)
  Deno.exit(1)
}

const meta = JSON.parse(new TextDecoder().decode(res.stdout))
if (meta.version !== version) {
  console.error(`version mismatch: got ${meta.version}, expected ${version}`)
  Deno.exit(1)
}

const optDeps = meta.optionalDependencies ?? {}
for (const target of targets) {
  const pkg = `${launcherName}-${target.suffix}`
  if (optDeps[pkg] !== version) {
    console.error(
      `missing or incorrect optionalDependency pin for ${pkg}: got ${
        optDeps[pkg]
      }, expected ${version}`,
    )
    Deno.exit(1)
  }
  console.log(`${target.suffix} pin ok`)
}
