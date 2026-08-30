#!/usr/bin/env -S deno run --allow-read --allow-run=comment-checker,direnv --allow-env=CLAUDE_PROJECT_DIR,PATH,HOME

import { writeAll } from '@std/io/write-all'
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
  if (fromDirenv !== 0 && fromDirenv !== 2) {
    await writeAll(
      Deno.stderr,
      new TextEncoder().encode('comment-checker did not run — nothing checked this write.\n'),
    )
  }
  Deno.exit(fromDirenv)
}

await writeAll(
  Deno.stderr,
  new TextEncoder().encode('comment-checker did not run — nothing checked this write.\n'),
)
Deno.exit(1)