#!/usr/bin/env -S deno run --allow-read --allow-run=comment-checker,direnv,bwrap --allow-env=CLAUDE_PROJECT_DIR,PATH,HOME

type Host = {
  projectDir: string
  which: (name: string) => string | undefined
  fileExists: (path: string) => boolean
  fileHead: (path: string) => string
}

type Launch =
  | { kind: 'run'; cmd: string; args: string[] }
  | { kind: 'missing'; hint: string }

const STRIP = ['--strip']
const ELF = '\x7fELF'
const MACHO_64BE = '\xcf\xfa\xed\xfe'
const MACHO_64LE = '\xfe\xed\xfa\xcf'

function planLaunch(host: Host): Launch {
  const checker = host.which('comment-checker')
  if (checker !== undefined) {
    if (host.which('bwrap') !== undefined && shouldBwrap(checker, host.fileHead(checker))) {
      return {
        kind: 'run',
        cmd: 'bwrap',
        args: [...bwrapArgs(checker, host.projectDir, host.fileExists), '--', checker, ...STRIP],
      }
    }
    return { kind: 'run', cmd: 'comment-checker', args: STRIP }
  }

  if (host.which('direnv') !== undefined) {
    return {
      kind: 'run',
      cmd: 'direnv',
      args: ['exec', host.projectDir, 'comment-checker', ...STRIP],
    }
  }

  const flake = host.fileExists(`${host.projectDir}/flake.nix`)
  return {
    kind: 'missing',
    hint: flake
      ? 'This project has flake.nix. Run direnv allow or nix develop so comment-checker is on PATH.'
      : 'Install it: pnpm add -g @systemfsoftware/claude-code-comment-checker',
  }
}

function shouldBwrap(binPath: string, head: string): boolean {
  if (head.includes('bwrap')) return false
  return head.startsWith(ELF) || head.startsWith(MACHO_64BE) || head.startsWith(MACHO_64LE)
}

function bwrapArgs(
  binPath: string,
  projectDir: string,
  fileExists: (path: string) => boolean,
): string[] {
  const binds: string[] = []
  for (const path of ['/nix/store', '/etc', '/usr', '/lib', '/lib64']) {
    if (fileExists(path)) binds.push('--ro-bind', path, path)
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

function whichOnPath(name: string): string | undefined {
  const delimiter = Deno.build.os === 'windows' ? ';' : ':'
  const slash = Deno.build.os === 'windows' ? '\\' : '/'
  const names = Deno.build.os === 'windows' ? [name, `${name}.exe`, `${name}.cmd`] : [name]
  for (const dir of (Deno.env.get('PATH') ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const n of names) {
      const candidate = `${dir}${slash}${n}`
      try {
        if (Deno.statSync(candidate).isFile) return candidate
      } catch {
        continue
      }
    }
  }
}

function liveHost(projectDir: string): Host {
  return {
    projectDir,
    which: whichOnPath,
    fileExists: (path) => {
      try {
        Deno.statSync(path)
        return true
      } catch {
        return false
      }
    },
    fileHead: (path) => {
      try {
        const file = Deno.openSync(path, { read: true })
        const buf = new Uint8Array(2048)
        const n = file.readSync(buf) ?? 0
        file.close()
        return new TextDecoder('latin1').decode(buf.subarray(0, n))
      } catch {
        return ''
      }
    },
  }
}

async function main(): Promise<never> {
  const projectDir = Deno.env.get('CLAUDE_PROJECT_DIR')
  if (projectDir === undefined || projectDir === '') {
    await Deno.stderr.write(
      new TextEncoder().encode('CLAUDE_PROJECT_DIR must be set by the hook host\n'),
    )
    Deno.exit(1)
  }

  const launch = planLaunch(liveHost(projectDir))
  if (launch.kind === 'missing') {
    await Deno.stderr.write(
      new TextEncoder().encode(
        [
          'comment-checker did not run, so nothing checked this write.',
          launch.hint,
          '',
        ].join('\n'),
      ),
    )
    Deno.exit(1)
  }

  const child = new Deno.Command(launch.cmd, {
    args: launch.args,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const { code } = await child.output()
  Deno.exit(code)
}

if (import.meta.main) {
  await main()
}
