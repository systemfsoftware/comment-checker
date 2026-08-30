#!/usr/bin/env -S deno run --allow-read=.envrc,flake.nix,.claude,hooks --allow-run=comment-checker,direnv,deno,nix,git,pnpm,npm,cargo,sh --allow-env=PATH,HOME,CLAUDE_PROJECT_DIR,XDG_CACHE_HOME

import { exists } from '@std/fs/exists'
import { join, resolve } from '@std/path'

const projectDir = resolve(Deno.args[0] ?? '.')
let failed = 0

function report(ok: boolean, name: string, detail: string, hint: string): void {
  const mark = ok ? '[ok]' : '[broken]'
  console.log(`${mark} ${name}: ${detail}`)
  if (!ok) {
    console.log(`      fix: ${hint}`)
    failed += 1
  }
}

async function safeExists(p: string): Promise<boolean> {
  try {
    return await exists(p)
  } catch {
    return false
  }
}

async function run(
  cmd: string,
  args: string[],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string } | undefined> {
  try {
    const p = new Deno.Command(cmd, {
      args,
      stdin: input === undefined ? 'null' : 'piped',
      stdout: 'piped',
      stderr: 'piped',
    })
    const child = p.spawn()
    if (input !== undefined) {
      const w = child.stdin.getWriter()
      await w.write(new TextEncoder().encode(input))
      await w.close()
    }
    const { code, stdout, stderr } = await child.output()
    return { code, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined
    throw e
  }
}

async function resolveOnPath(name: string): Promise<string | undefined> {
  const r = await run('sh', ['-lc', `command -v ${name}`])
  const line = r !== undefined && r.code === 0 ? r.stdout.trim() : ''
  return line.length > 0 && line !== name ? line : undefined
}

const envrcPath = join(projectDir, '.envrc')
const flakePath = join(projectDir, 'flake.nix')
const hooksPath = join(projectDir, '.claude', 'hooks', 'hooks.json')
const claudeSettingsPath = join(projectDir, '.claude', 'settings.json')

const culpritPayload = JSON.stringify({
  tool_name: 'Write',
  tool_input: { file_path: 'demo.ts', content: '// increment counter\nlet counter = 0;\ncounter += 1;\n' },
})
const cleanPayload = JSON.stringify({
  tool_name: 'Write',
  tool_input: { file_path: 'demo.ts', content: '// SPDX-License-Identifier: Apache-2.0\nexport const x = 1;\n' },
})

const versionExpected = /^claude-code-comment-checker\s+\d+\.\d+\.\d+\s*$/m

const resolved = await resolveOnPath('comment-checker')
const onPath = resolved !== undefined
report(
  onPath,
  'comment-checker on PATH',
  onPath ? resolved! : 'no comment-checker executable found on PATH',
  'Install it (npm global) or enter a dev shell that provides it; see references/setup-resolution.md in this skill',
)

let identityOk = false
let versionLine = ''
if (onPath) {
  const v = await run('comment-checker', ['--version'])
  if (v !== undefined) {
    versionLine = v.stdout.trim().split('\n')[0] ?? ''
    identityOk = versionExpected.test(versionLine)
  }
}
report(
  identityOk,
  'binary identity',
  identityOk ? versionLine : `unexpected version output: ${versionLine || '(empty)'}`,
  'A different program named comment-checker is shadowing the real one on PATH; remove or reorder it, then re-run',
)

let blocks = false
let spares = false
const contractChecked = identityOk || onPath
if (identityOk || onPath) {
  const block = await run('comment-checker', [], culpritPayload)
  const spare = await run('comment-checker', [], cleanPayload)
  blocks = block !== undefined && block.code === 2 && /unnecessary/i.test(block.stderr)
  spares = spare !== undefined && spare.code === 0
}
const contractOk = blocks && spares
report(
  contractOk,
  'exit-code contract',
  contractChecked
    ? contractOk
      ? 'blocks restating comments (exit 2) and spares clean input (exit 0)'
      : `block exits ${blocks ? 'right' : 'wrong'}, spare ${spares ? 'right' : 'wrong'}`
    : 'no binary to exercise',
  'The resolved binary is not behaving like comment-checker; reinstall it or fix PATH ordering',
)

const hookPresent =
  (await safeExists(join(projectDir, 'hooks', 'hooks.json'))) ||
  (await safeExists(hooksPath)) ||
  (await safeExists(claudeSettingsPath))
if (hookPresent) {
  const denoV = await run('deno', ['--version'])
  const denoOk = denoV !== undefined && denoV.code === 0
  report(true, 'hook wiring present', 'PostToolUse hook file found (hooks/hooks.json, .claude/hooks, or .claude/settings.json)', '')
  report(denoOk, 'deno on PATH', denoOk ? 'deno resolves' : 'deno not found', 'Install Deno; the hook bridge runs via `deno run`')
} else {
  report(false, 'hook wiring present', 'no PostToolUse hook file found in this project', 'Install the plugin or add the hook entry to .claude/settings.json; see the plugin README')
}

const hasEnvrc = await safeExists(envrcPath)
if (hasEnvrc) {
  const dv = await run('direnv', ['exec', projectDir, 'sh', '-c', 'command -v comment-checker'])
  const direnvOk = dv !== undefined && dv.code === 0 && dv.stdout.trim().length > 0
  report(
    direnvOk,
    'direnv bridge',
    direnvOk ? `direnv exec resolves: ${dv!.stdout.trim()}` : `direnv exec failed (exit ${dv?.code ?? 'n/a'}): ${(dv?.stderr ?? '').trim().split('\n')[0] ?? 'direnv not installed'}`,
    'Run `direnv allow` in the project (a blocked .envrc loads nothing), then re-run',
  )
} else {
  report(false, 'direnv bridge', 'no .envrc found', 'Add `.envrc` containing `use flake` when the project is flake-based, or install the checker globally so it resolves without direnv')
}

const hasFlake = await safeExists(flakePath)
if (hasFlake) {
  const nv = await run('nix', ['develop', '--command', 'sh', '-lc', 'command -v comment-checker'])
  const nixOk = nv !== undefined && nv.code === 0 && nv.stdout.trim().length > 0
  report(
    nixOk,
    'flake dev shell',
    nixOk ? `nix develop resolves: ${nv!.stdout.trim()}` : `nix develop failed (exit ${nv?.code ?? 'n/a'}): ${(nv?.stderr ?? '').trim().split('\n').find((l) => l.includes('error')) ?? 'nix not installed or flake build failed'}`,
    'Build or enter the dev shell once (`nix develop`), or rely on direnv; see references/setup-resolution.md',
  )
} else {
  report(true, 'flake dev shell', 'no flake.nix (npm global install is the path)', '')
}

if (failed === 0) {
  console.log('comment-checker doctor: all checks passed')
} else {
  console.log(`comment-checker doctor: ${failed} check(s) broken`)
}
Deno.exit(failed === 0 ? 0 : 1)