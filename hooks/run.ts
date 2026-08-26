#!/usr/bin/env -S deno run --allow-read --allow-run=comment-checker,direnv,bwrap --allow-env=CLAUDE_PROJECT_DIR,PATH,HOME

import { startsWith } from '@std/bytes'
import { exists } from '@std/fs/exists'
import { writeAll } from '@std/io/write-all'
import { DELIMITER, join } from '@std/path'
import { type } from 'arktype'

const Launch = type({
  kind: "'run'",
  cmd: 'string',
  args: 'string[]',
}).or({
  kind: "'missing'",
  hint: 'string',
})
type Launch = typeof Launch.infer

const STRIP = ['--strip']
const ELF = Uint8Array.of(0x7f, 0x45, 0x4c, 0x46)
const MACHO_64_LE = Uint8Array.of(0xcf, 0xfa, 0xed, 0xfe)
const MACHO_64_BE = Uint8Array.of(0xfe, 0xed, 0xfa, 0xcf)
const encoder = new TextEncoder()

async function whichOnPath(name: string): Promise<string | undefined> {
  const names = Deno.build.os === 'windows' ? [name, `${name}.exe`, `${name}.cmd`] : [name]
  for (const dir of (Deno.env.get('PATH') ?? '').split(DELIMITER)) {
    if (dir === '') continue
    for (const n of names) {
      const candidate = join(dir, n)
      if (await exists(candidate)) return candidate
    }
  }
}

async function fileHead(path: string): Promise<Uint8Array> {
  const file = await Deno.open(path, { read: true })
  try {
    const buf = new Uint8Array(2048)
    const n = await file.read(buf) ?? 0
    return buf.subarray(0, n)
  } finally {
    file.close()
  }
}

function nativeBinary(head: Uint8Array): boolean {
  return startsWith(head, ELF) || startsWith(head, MACHO_64_LE) || startsWith(head, MACHO_64_BE)
}

async function bwrapArgs(binPath: string, projectDir: string): Promise<string[]> {
  const binds: string[] = []
  for (const path of ['/nix/store', '/etc', '/usr', '/lib', '/lib64']) {
    if (await exists(path)) binds.push('--ro-bind', path, path)
  }
  return [
    ...binds,
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
    binPath,
    binPath,
    '--chdir',
    projectDir,
  ]
}

async function planLaunch(projectDir: string): Promise<Launch> {
  const checker = await whichOnPath('comment-checker')
  if (checker !== undefined) {
    const bwrap = await whichOnPath('bwrap')
    if (bwrap !== undefined) {
      const head = await fileHead(checker)
      const wrapper = new TextDecoder('latin1').decode(head).includes('bwrap')
      if (!wrapper && nativeBinary(head)) {
        return Launch.assert({
          kind: 'run',
          cmd: 'bwrap',
          args: [...await bwrapArgs(checker, projectDir), '--', checker, ...STRIP],
        })
      }
    }
    return Launch.assert({ kind: 'run', cmd: 'comment-checker', args: STRIP })
  }

  if (await whichOnPath('direnv') !== undefined) {
    return Launch.assert({
      kind: 'run',
      cmd: 'direnv',
      args: ['exec', projectDir, 'comment-checker', ...STRIP],
    })
  }

  const flake = await exists(join(projectDir, 'flake.nix'))
  return Launch.assert({
    kind: 'missing',
    hint: flake
      ? 'This project has flake.nix. Run direnv allow or nix develop so comment-checker is on PATH.'
      : 'Install it: pnpm add -g @systemfsoftware/claude-code-comment-checker',
  })
}

async function main(): Promise<never> {
  const projectDir = Deno.env.get('CLAUDE_PROJECT_DIR')
  if (projectDir === undefined || projectDir === '') {
    await writeAll(
      Deno.stderr,
      encoder.encode('CLAUDE_PROJECT_DIR must be set by the hook host\n'),
    )
    Deno.exit(1)
  }

  const launch = await planLaunch(projectDir)
  if (launch.kind === 'missing') {
    await writeAll(
      Deno.stderr,
      encoder.encode(
        [
          'comment-checker did not run, so nothing checked this write.',
          launch.hint,
          '',
        ].join('\n'),
      ),
    )
    Deno.exit(1)
  }

  const { code } = await new Deno.Command(launch.cmd, {
    args: launch.args,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  Deno.exit(code)
}

await main()
