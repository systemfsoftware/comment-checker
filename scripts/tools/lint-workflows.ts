#!/usr/bin/env -S deno run --allow-read --allow-run=docker,podman --allow-env=WORKFLOW_LINT_RUNTIME

// Lint the workflow files with a digest-pinned actionlint container.
//
// Runs the same command locally and in CI so a workflow defect is caught before
// the push rather than by the run it would have broken. actionlint's real target
// is release.yml: that workflow never executes on a pull request, so this is the
// only gate that reads it at all.
//
// Not the marketplace action: rhysd/actionlint ships no action.yml (its repo root
// holds only a Dockerfile), so GitHub treats it as an implicit Docker action whose
// inputs are entryPoint/args. A `paths:` input is silently discarded, which left
// the gate linting the container default instead of the files it named.

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
      // binary absent on this machine: try the next runtime
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
