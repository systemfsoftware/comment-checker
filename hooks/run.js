#!/usr/bin/env -S deno run --allow-read --allow-run=comment-checker,direnv --allow-env=CLAUDE_PROJECT_DIR,PATH,HOME

import { exists } from '@std/fs/exists'
import { writeAll } from '@std/io/write-all'
import { join } from '@std/path'
import { type } from 'arktype'

const Env = type({
  CLAUDE_PROJECT_DIR: type('string.trim').pipe(type('string').atLeastLength(1)),
})

const env = Env({
  CLAUDE_PROJECT_DIR: Deno.env.get('CLAUDE_PROJECT_DIR') ?? '',
})

if (env instanceof type.errors) {
  await writeAll(
    Deno.stderr,
    new TextEncoder().encode(`CLAUDE_PROJECT_DIR must be set by the hook host\n${env.summary}\n`),
  )
  Deno.exit(1)
}

/** @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<number | undefined>}
 */
async function run(cmd, args) {
  try {
    const { code } = await new Deno.Command(cmd, {
      args,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).output()
    return code
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}

const strip = ['--strip']
const projectDir = env.CLAUDE_PROJECT_DIR

const fromPath = await run('comment-checker', strip)
if (fromPath !== undefined) Deno.exit(fromPath)

const fromDirenv = await run('direnv', ['exec', projectDir, 'comment-checker', ...strip])
if (fromDirenv !== undefined) Deno.exit(fromDirenv)

const flake = await exists(join(projectDir, 'flake.nix'))
await writeAll(
  Deno.stderr,
  new TextEncoder().encode(
    [
      'comment-checker did not run, so nothing checked this write.',
      flake
        ? 'This project has flake.nix. Run direnv allow or nix develop so comment-checker is on PATH (the flake wraps it in bwrap).'
        : 'Install it: pnpm add -g @systemfsoftware/claude-code-comment-checker',
      '',
    ].join('\n'),
  ),
)
Deno.exit(1)
