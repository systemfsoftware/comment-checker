import { assertEquals, assertThrows } from '@std/assert'
import { matrixRows } from '../lib/matrix-rows.ts'

// Issue #8 regression fixture: the workflow must be parsed as YAML, so
// formatting variants (flow-style include list, quoted target, reordered
// keys, comments) resolve to the same typed rows the regex scraper used to
// miss — which let the gate pass vacuously.
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
          { suffix: darwin-x64, target: x86_64-apple-darwin },
          { target: aarch64-apple-darwin, suffix: darwin-arm64 },
          { target: x86_64-pc-windows-msvc, suffix: win32-x64 },
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
            runner: macos-13
          - target: aarch64-apple-darwin
            suffix: darwin-arm64
            runner: macos-14
          - target: x86_64-pc-windows-msvc
            suffix: win32-x64
            runner: windows-2022
`

const EXPECTED: Array<[string, string]> = [
  ['x86_64-unknown-linux-gnu', 'linux-x64'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64'],
  ['x86_64-apple-darwin', 'darwin-x64'],
  ['aarch64-apple-darwin', 'darwin-arm64'],
  ['x86_64-pc-windows-msvc', 'win32-x64'],
]

Deno.test('matrixRows parses the block-style workflow', () => {
  const rows = matrixRows(BLOCK_STYLE)
  assertEquals(rows.map((r) => [r.target, r.suffix]), EXPECTED)
})

Deno.test('matrixRows parses the flow-style workflow (issue #8 regression)', () => {
  const rows = matrixRows(FLOW_STYLE)
  assertEquals(rows.map((r) => [r.target, r.suffix]), EXPECTED)
})

Deno.test('matrixRows throws on malformed YAML (gate must fail loudly)', () => {
  // A parse error must propagate so the check-matrix CLI reports FAIL rather
  // than comparing against an empty row set.
  assertThrows(() => matrixRows('jobs: [unclosed'))
})

Deno.test('matrixRows ignores jobs without a matrix include', () => {
  assertEquals(matrixRows('jobs:\n  lint:\n    runs-on: ubuntu-latest\n'), [])
})
