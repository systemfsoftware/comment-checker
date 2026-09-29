#!/usr/bin/env -S deno run --allow-read --allow-run=comment-checker,direnv --allow-env=CLAUDE_PROJECT_DIR,PATH,HOME

import { writeAll } from '@std/io/write-all'
import { type } from 'arktype'

const NOT_RUN = 'comment-checker did not run — nothing checked this write.'
const failed = (code: number) => `comment-checker failed (exit ${code}) — nothing checked this write.`
// Deno itself exits 1 on errors and 101 on panics, never 3, so hooks.json can read 3 as "run.ts already reported".
const REPORTED_UNCHECKED = 3

async function report(lines: string[]): Promise<never> {
  await Deno.stdin.readable.pipeTo(new WritableStream())
  await writeAll(Deno.stderr, new TextEncoder().encode(lines.map((line) => `${line}\n`).join('')))
  Deno.exit(REPORTED_UNCHECKED)
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

async function checkerExit(projectDir: string): Promise<number | undefined> {
  const fromPath = await run('comment-checker', [])
  if (fromPath !== undefined) return fromPath
  const fromDirenv = await run('direnv', [
    'exec',
    projectDir,
    'sh',
    '-c',
    'command -v comment-checker >/dev/null 2>&1 || exit 127; exec comment-checker',
  ])
  return fromDirenv === 127 ? undefined : fromDirenv
}

const Env = type({
  CLAUDE_PROJECT_DIR: type('string.trim').pipe(type('string').atLeastLength(1)),
})

const env = Env({
  CLAUDE_PROJECT_DIR: Deno.env.get('CLAUDE_PROJECT_DIR') ?? '',
})

if (env instanceof type.errors) {
  await report([`CLAUDE_PROJECT_DIR must be set by the hook host\n${env.summary}`, NOT_RUN])
} else {
  const code = await checkerExit(env.CLAUDE_PROJECT_DIR)
  if (code === 0 || code === 2) Deno.exit(code)
  await report([code === undefined ? NOT_RUN : failed(code)])
}
