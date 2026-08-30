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

// Any spawn failure — NotFound, NotCapable (the hook host scrubs
// Deno-sensitive env vars before launching this script), or anything else —
// means "binary unavailable": the fallback chain decides, never an uncaught
// error that would break the write the hook is gating.
async function run(cmd: string, args: string[]): Promise<number | undefined> {
  try {
    const { code } = await new Deno.Command(cmd, {
      args,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).output()
    return code
  } catch {
    return undefined
  }
}

const projectDir = env.CLAUDE_PROJECT_DIR

const fromPath = await run('comment-checker', [])
if (fromPath !== undefined) Deno.exit(fromPath)

const fromDirenv = await run('direnv', ['exec', projectDir, 'comment-checker'])
if (fromDirenv !== undefined) {
  // direnv ran but produced no verdict (0 = clean, 2 = flagged): either it
  // could not find the checker or it failed for its own reasons. Keep the
  // gate non-zero and make sure the "nothing checked" guidance still lands
  // instead of direnv's raw error being the only message.
  if (fromDirenv !== 0 && fromDirenv !== 2) {
    const flakeDirs = await exists(join(projectDir, 'flake.nix'))
    const guid = flakeDirs
      ? 'This project has flake.nix. Run direnv allow or nix develop so comment-checker is on PATH (the flake wraps it in bwrap).'
      : 'Install it: pnpm add -g @systemfsoftware/claude-code-comment-checker'
    await writeAll(
      Deno.stderr,
      new TextEncoder().encode(`${guid}\ncomment-checker did not run — nothing checked this write.\n`),
    )
  }
  Deno.exit(fromDirenv)
}

const flake = await exists(join(projectDir, 'flake.nix'))
const hint = flake
  ? 'This project has flake.nix. Run direnv allow or nix develop so comment-checker is on PATH (the flake wraps it in bwrap).'
  : 'Install it: pnpm add -g @systemfsoftware/claude-code-comment-checker'
await writeAll(
  Deno.stderr,
  new TextEncoder().encode(`${hint}\ncomment-checker did not run — nothing checked this write.\n`),
)
Deno.exit(1)