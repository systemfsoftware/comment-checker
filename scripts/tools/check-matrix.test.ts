import { assertEquals, assertThrows } from '@std/assert'
import { matrixRows } from '../lib/matrix-rows.ts'

// Issue #8 regression fixtures: the workflow must be parsed as YAML, so
// formatting variants (flow-style include list, quoted target, reordered
// keys, comments) resolve to the same typed rows. The gate now reads ONLY
// the named `release` job, requires every row to carry target/suffix/runner,
// and throws (fails loudly) on any malformed/empty matrix.

const FLOW_STYLE = `name: Release
on:
  push:
    tags: ['v*']  # quoted scalar in a flow list

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include: [
          { target: "x86_64-unknown-linux-gnu", suffix: linux-x64, runner: ubuntu-latest },
          { target: aarch64-unknown-linux-gnu, runner: "ubuntu-24.04-arm", suffix: linux-arm64 },
          { suffix: darwin-x64, target: x86_64-apple-darwin, runner: macos-14 },
          { target: aarch64-apple-darwin, suffix: darwin-arm64, runner: macos-14 },
          { target: x86_64-pc-windows-msvc, suffix: win32-x64, runner: windows-2022 },
        ]
`

const BLOCK_STYLE = `name: Release
on:
  push:
    tags:
      - 'v*'
jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - target: x86_64-unknown-linux-gnu
            suffix: linux-x64
            runner: ubuntu-latest
          - target: aarch64-unknown-linux-gnu
            suffix: linux-arm64
            runner: ubuntu-24.04-arm
          - target: x86_64-apple-darwin
            suffix: darwin-x64
            runner: macos-14
          - target: aarch64-apple-darwin
            suffix: darwin-arm64
            runner: macos-14
          - target: x86_64-pc-windows-msvc
            suffix: win32-x64
            runner: windows-2022
`

const EXPECTED: Array<[string, string, string]> = [
  ['x86_64-unknown-linux-gnu', 'linux-x64', 'ubuntu-latest'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64', 'ubuntu-24.04-arm'],
  ['x86_64-apple-darwin', 'darwin-x64', 'macos-14'],
  ['aarch64-apple-darwin', 'darwin-arm64', 'macos-14'],
  ['x86_64-pc-windows-msvc', 'win32-x64', 'windows-2022'],
]

Deno.test('matrixRows parses the block-style workflow', () => {
  const rows = matrixRows(BLOCK_STYLE)
  assertEquals(
    rows.map((r) => [r.target, r.suffix, r.runner]),
    EXPECTED,
  )
})

Deno.test('matrixRows parses the flow-style workflow (issue #8 regression)', () => {
  const rows = matrixRows(FLOW_STYLE)
  assertEquals(
    rows.map((r) => [r.target, r.suffix, r.runner]),
    EXPECTED,
  )
})

Deno.test('matrixRows throws on malformed YAML (gate must fail loudly)', () => {
  assertThrows(() => matrixRows('jobs: [unclosed'))
})

Deno.test('matrixRows throws when the release job is missing (issue #8 refit)', () => {
  // A decoy job with a matrix must NOT satisfy the gate: only the named
  // `release` job is authoritative, so a workflow without it throws.
  assertThrows(() =>
    matrixRows(
      'jobs:\n' +
        '  build:\n' +
        '    strategy:\n' +
        '      matrix:\n' +
        '        include:\n' +
        '          - target: x86_64-unknown-linux-gnu\n' +
        '            suffix: linux-x64\n' +
        '            runner: ubuntu-latest\n',
    )
  )
})

Deno.test('matrixRows throws when the release matrix include is empty', () => {
  assertThrows(() =>
    matrixRows(
      'jobs:\n' +
        '  release:\n' +
        '    strategy:\n' +
        '      matrix:\n' +
        '        include: []\n',
    )
  )
})

Deno.test('matrixRows throws when a release row lacks a runner (#5)', () => {
  assertThrows(() =>
    matrixRows(
      'jobs:\n' +
        '  release:\n' +
        '    strategy:\n' +
        '      matrix:\n' +
        '        include:\n' +
        '          - target: x86_64-unknown-linux-gnu\n' +
        '            suffix: linux-x64\n',
    )
  )
})

Deno.test('matrixRows throws when a release row has a non-string suffix (#11)', () => {
  assertThrows(() =>
    matrixRows(
      'jobs:\n' +
        '  release:\n' +
        '    strategy:\n' +
        '      matrix:\n' +
        '        include:\n' +
        '          - target: x86_64-unknown-linux-gnu\n' +
        '            suffix: [linux, x64]\n' +
        '            runner: ubuntu-latest\n',
    )
  )
})
