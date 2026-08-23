#!/usr/bin/env -S deno run --allow-read --allow-run=docker,podman --allow-env=WORKFLOW_LINT_RUNTIME

import { RELEASE_WORKFLOW_PATH } from '../lib/shared.ts'
import { join, relative } from '@std/path'

const IMAGE =
  'docker.io/rhysd/actionlint@sha256:9d36088643581e728c969f35141f88139fec77280b2be23c1f66f8e40e1025e7'

const repoRoot = join(import.meta.dirname!, '..', '..')
const workflows = [
  relative(repoRoot, join(repoRoot, '.github', 'workflows', 'ci.yml')),
  relative(repoRoot, RELEASE_WORKFLOW_PATH),
]

async function firstAvailable(candidates: string[]): Promise<string | undefined> {
  for (const bin of candidates) {
    try {
      const probe = await new Deno.Command(bin, {
        args: ['--version'],
        stdout: 'null',
        stderr: 'null',
      }).output()
      if (probe.success) return bin
    } catch {
      continue
    }
  }
  return undefined
}

const preferred = Deno.env.get('WORKFLOW_LINT_RUNTIME')
const runtime = preferred ?? (await firstAvailable(['docker', 'podman']))
if (!runtime) {
  console.error('lint-workflows: no docker or podman on PATH')
  Deno.exit(1)
}

for (const path of workflows) {
  const mode = (await Deno.stat(join(repoRoot, path))).mode
  if (mode !== null && (mode & 0o044) === 0) {
    console.error(
      `lint-workflows: ${path} is mode ${(mode & 0o777).toString(8)}, unreadable inside the ` +
        `container -- run: chmod 644 ${path}`,
    )
    Deno.exit(1)
  }
}

const out = await new Deno.Command(runtime, {
  args: [
    'run',
    '--rm',
    '-v',
    `${repoRoot}:/repo`,
    '-w',
    '/repo',
    IMAGE,
    '-color',
    ...workflows,
  ],
  stdout: 'inherit',
  stderr: 'inherit',
}).output()

if (!out.success) {
  console.error(`lint-workflows: actionlint reported findings in ${workflows.join(', ')}`)
  Deno.exit(out.code)
}
console.log(`lint-workflows: ok (${workflows.join(', ')})`)
