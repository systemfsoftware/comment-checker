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

function spawnEnv(): Record<string, string> {
  return {
    PATH: Deno.env.get('PATH') ?? '',
    HOME: Deno.env.get('HOME') ?? '',
  }
}

async function run(cmd: string, args: string[]): Promise<number | undefined> {
  try {
    const { code } = await new Deno.Command(cmd, {
      args,
      env: spawnEnv(),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).output()
    return code
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    if (error instanceof Deno.errors.NotCapable) return undefined
    return undefined
  }
}

const projectDir = env.CLAUDE_PROJECT_DIR

const fromPath = await run('comment-checker', [])
if (fromPath !== undefined) Deno.exit(fromPath)

const fromDirenv = await run('direnv', ['exec', projectDir, 'comment-checker'])
if (fromDirenv !== undefined) Deno.exit(fromDirenv)

const flake = await exists(join(projectDir, 'flake.nix'))
const hint = flake
  ? 'This project has flake.nix. Run direnv allow or nix develop so comment-checker is on PATH (the flake wraps it in bwrap).'
  : 'Install it: pnpm add -g @systemfsoftware/claude-code-comment-checker'
await writeAll(
  Deno.stderr,
  new TextEncoder().encode(`${hint}\ncomment-checker did not run — nothing checked this write.\n`),
)
Deno.exit(1)