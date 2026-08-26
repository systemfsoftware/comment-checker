#!/usr/bin/env -S deno run --allow-read --allow-run=comment-checker,direnv,bwrap --allow-env=CLAUDE_PROJECT_DIR,PATH,HOME

import { exists } from '@std/fs/exists'
import { writeAll } from '@std/io/write-all'
import { DELIMITER, join } from '@std/path'
import { type } from 'arktype'

const Env = type({
  CLAUDE_PROJECT_DIR: type('string.trim').pipe(type('string').atLeastLength(1)),
  'PATH?': type('string').pipe((s: string) =>
    s.split(DELIMITER).filter((dir) => dir.length > 0)
  ),
})

const STRIP = ['--strip']
const BIND_ROOTS = ['/nix/store', '/etc', '/usr', '/lib', '/lib64'] as const
const encoder = new TextEncoder()

const env = Env({
  CLAUDE_PROJECT_DIR: Deno.env.get('CLAUDE_PROJECT_DIR') ?? '',
  PATH: Deno.env.get('PATH'),
})

if (env instanceof type.errors) {
  await writeAll(
    Deno.stderr,
    encoder.encode(`CLAUDE_PROJECT_DIR must be set by the hook host\n${env.summary}\n`),
  )
  Deno.exit(1)
}

async function locate(
  dirs: readonly string[],
  names: readonly string[],
): Promise<Record<string, string>> {
  const found: Record<string, string> = {}
  const pending = new Set(names)
  for (const dir of dirs) {
    if (pending.size === 0) break
    const hits = await Promise.all(
      [...pending].map(async (name) => {
        const candidate = join(dir, name)
        return (await exists(candidate)) ? ([name, candidate] as const) : undefined
      }),
    )
    for (const hit of hits) {
      if (hit === undefined) continue
      found[hit[0]] = hit[1]
      pending.delete(hit[0])
      if (hit[0] === 'comment-checker') pending.delete('direnv')
    }
  }
  return found
}

async function sandboxArgs(bin: string, projectDir: string): Promise<string[]> {
  const binds = await Promise.all(
    BIND_ROOTS.map(async (root) =>
      (await exists(root)) ? ['--ro-bind', root, root] : []
    ),
  )
  return [
    ...binds.flat(),
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--unshare-net',
    '--die-with-parent',
    '--ro-bind',
    projectDir,
    projectDir,
    '--ro-bind',
    bin,
    bin,
    '--chdir',
    projectDir,
  ]
}

const bins = await locate(env.PATH ?? [], ['comment-checker', 'bwrap', 'direnv'])
const projectDir = env.CLAUDE_PROJECT_DIR

let cmd: string
let args: string[]

if (bins['comment-checker'] !== undefined) {
  const checker = bins['comment-checker']
  cmd = 'comment-checker'
  args = STRIP
  if (bins['bwrap'] !== undefined) {
    const file = await Deno.open(checker, { read: true })
    const head = new Uint8Array(256)
    const n = await file.read(head) ?? 0
    file.close()
    const b0 = head[0]
    const b1 = head[1]
    const b2 = head[2]
    const b3 = head[3]
    const native = n >= 4 && (
      (b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46) ||
      (b0 === 0xcf && b1 === 0xfa && b2 === 0xed && b3 === 0xfe) ||
      (b0 === 0xfe && b1 === 0xed && b2 === 0xfa && b3 === 0xcf)
    )
    const wrapped = new TextDecoder('latin1').decode(head.subarray(0, n)).includes('bwrap')
    if (native && !wrapped) {
      cmd = 'bwrap'
      args = [...await sandboxArgs(checker, projectDir), '--', checker, ...STRIP]
    }
  }
} else if (bins['direnv'] !== undefined) {
  cmd = 'direnv'
  args = ['exec', projectDir, 'comment-checker', ...STRIP]
} else {
  const flake = await exists(join(projectDir, 'flake.nix'))
  await writeAll(
    Deno.stderr,
    encoder.encode(
      [
        'comment-checker did not run, so nothing checked this write.',
        flake
          ? 'This project has flake.nix. Run direnv allow or nix develop so comment-checker is on PATH.'
          : 'Install it: pnpm add -g @systemfsoftware/claude-code-comment-checker',
        '',
      ].join('\n'),
    ),
  )
  Deno.exit(1)
}

const { code } = await new Deno.Command(cmd, {
  args,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).output()
Deno.exit(code)
