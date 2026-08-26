function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`not equal: ${Deno.inspect(actual)} vs ${Deno.inspect(expected)}`)
  }
}

import { bwrapArgs, type Host, planLaunch, shouldBwrap } from './run.ts'

function host(overrides: Partial<Host> & Pick<Host, 'which'>): Host {
  return {
    projectDir: '/proj',
    fileExists: () => false,
    fileHead: () => '',
    ...overrides,
  }
}

Deno.test('PATH native binary plus bwrap wraps and strips', () => {
  const launch = planLaunch(host({
    which: (name) =>
      name === 'comment-checker'
        ? '/bin/comment-checker'
        : name === 'bwrap'
        ? '/bin/bwrap'
        : undefined,
    fileHead: () => '\x7fELF',
    fileExists: (path) => path === '/usr' || path === '/proj',
  }))
  assertEquals(launch.kind, 'run')
  if (launch.kind !== 'run') return
  assertEquals(launch.cmd, 'bwrap')
  assertEquals(launch.args.at(-2), '/bin/comment-checker')
  assertEquals(launch.args.at(-1), '--strip')
})

Deno.test('PATH wrapper that already calls bwrap is not wrapped again', () => {
  const launch = planLaunch(host({
    which: (name) =>
      name === 'comment-checker'
        ? '/nix/bin/comment-checker'
        : name === 'bwrap'
        ? '/bin/bwrap'
        : undefined,
    fileHead: () => '#!/bin/sh\nexec bwrap --ro-bind /nix/store',
  }))
  assertEquals(launch, {
    kind: 'run',
    cmd: 'comment-checker',
    args: ['--strip'],
  })
})

Deno.test('direnv is used when comment-checker is not on PATH', () => {
  const launch = planLaunch(host({
    which: (name) => name === 'direnv' ? '/bin/direnv' : undefined,
  }))
  assertEquals(launch, {
    kind: 'run',
    cmd: 'direnv',
    args: ['exec', '/proj', 'comment-checker', '--strip'],
  })
})

Deno.test('missing checker with flake.nix names nix and direnv', () => {
  const launch = planLaunch(host({
    which: () => undefined,
    fileExists: (path) => path === '/proj/flake.nix',
  }))
  assertEquals(launch.kind, 'missing')
  if (launch.kind !== 'missing') return
  assertEquals(launch.hint.includes('flake.nix'), true)
  assertEquals(launch.hint.includes('direnv allow'), true)
})

Deno.test('missing checker without flake names the npm package', () => {
  const launch = planLaunch(host({
    which: () => undefined,
  }))
  assertEquals(launch.kind, 'missing')
  if (launch.kind !== 'missing') return
  assertEquals(
    launch.hint.includes('@systemfsoftware/claude-code-comment-checker'),
    true,
  )
})

Deno.test('shouldBwrap is only for native binaries', () => {
  assertEquals(shouldBwrap('/bin/cc', '\x7fELF rest'), true)
  assertEquals(shouldBwrap('/bin/cc', '#!/usr/bin/env node\n'), false)
  assertEquals(shouldBwrap('/bin/cc', '#!/bin/sh\nbwrap --ro-bind'), false)
})

Deno.test('bwrapArgs binds existing roots and the binary', () => {
  const args = bwrapArgs(
    '/bin/comment-checker',
    '/proj',
    (path) => path === '/nix/store' || path === '/usr' || path === '/proj',
  )
  assertEquals(args.includes('/nix/store'), true)
  assertEquals(args.includes('/usr'), true)
  assertEquals(args.includes('/lib'), false)
  assertEquals(args.at(-3), '/bin/comment-checker')
  assertEquals(args.at(-1), '/proj')
})
