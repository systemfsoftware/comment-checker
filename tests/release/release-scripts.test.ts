import { join } from '@std/path'
import {
  assertEquals,
  assertFalse,
  assertMatch,
  assertNotEquals,
  assertObjectMatch,
  assertRejects,
} from '@std/assert'

const ROOT = join(import.meta.dirname!, '..', '..')
const RELEASE = join(ROOT, 'scripts', 'release')
const MANIFEST_PATH = join(
  ROOT,
  'npm',
  'packages',
  'comment-checker',
  'package.json',
)
const TARGETS_PATH = join(RELEASE, 'targets.json')
const RELEASE_WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'release.yml')

// The supported platform set (KD1) — the launcher resolves its platform package
// by identity as <launcher-name>-<platform>-<arch>, so these five pairs are the
// product contract the table must name exactly.
const EXPECTED_SUFFIXES = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
] as const
const LAUNCHER_PREFIX = '@systemfsoftware/claude-code-comment-checker'

const decode = (u8: Uint8Array) => new TextDecoder().decode(u8)

async function withTmp(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: 'release-scripts-' })
  try {
    await fn(dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

// Scripts run with the same permission surface the deno.jsonc tasks declare:
// read the table + launcher manifest + workflow, write only the caller's
// explicit --out / copies. The suite never touches the committed manifest.
function runScript(
  script: string,
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string; writeAllow?: string } = {},
): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
  const { env = {}, cwd = ROOT, writeAllow = 'unused' } = opts
  const callerPaths: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--suffix' || args[i] === '--version') {
      i++
    } else if (
      args[i] === '--out' || args[i] === '--manifest-path' ||
      args[i] === '--targets' || args[i] === '--workflow-path'
    ) {
      callerPaths.push(args[++i])
    }
  }
  const read = [
    TARGETS_PATH,
    MANIFEST_PATH,
    RELEASE_WORKFLOW_PATH,
    ...callerPaths,
  ].join(',')
  const cmd = new Deno.Command('deno', {
    args: [
      'run',
      `--allow-read=${read}`,
      `--allow-write=${writeAllow}`,
      `--allow-env`,
      join(RELEASE, script),
      ...args,
    ],
    cwd,
    env: { ...Deno.env.toObject(), ...env },
    stdout: 'piped',
    stderr: 'piped',
  })
  return cmd.output().then((r) => ({
    code: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
  }))
}

const readTable = async () =>
  JSON.parse(await Deno.readTextFile(TARGETS_PATH)) as Array<{
    target: string
    suffix: string
    os: string
    cpu: string
    libc?: string
    bin: string
  }>

Deno.test('targets.json names exactly the five supported platform/arch pairs', async () => {
  const table = await readTable()
  const suffixes = table.map((t) => t.suffix).sort()
  assertEquals(suffixes, [...EXPECTED_SUFFIXES].sort())
})

Deno.test('generate-platform-manifest emits the correct package.json for each targets.json entry', async () => {
  await withTmp(async (tmp) => {
    const table = await readTable()
    const launcher = JSON.parse(await Deno.readTextFile(MANIFEST_PATH))
    const cases = table.map(async (entry) => {
      const out = join(tmp, `gen-${entry.suffix}`)
      const res = await runScript('generate-platform-manifest.ts', [
        '--suffix',
        entry.suffix,
        '--version',
        '0.1.0',
        '--out',
        out,
      ], { writeAllow: out })
      assertEquals(res.code, 0, decode(res.stderr))

      const pkg = JSON.parse(
        await Deno.readTextFile(join(out, 'package.json')),
      )
      assertEquals(pkg.name, `${LAUNCHER_PREFIX}-${entry.suffix}`)
      assertEquals(pkg.name, `${launcher.name}-${entry.suffix}`)
      assertEquals(pkg.version, '0.1.0')
      assertEquals(pkg.license, 'Apache-2.0')
      assertObjectMatch(pkg.repository, launcher.repository)
      assertEquals(pkg.os, [entry.os])
      assertEquals(pkg.cpu, [entry.cpu])
      assertEquals(pkg.files, [entry.bin])
      assertEquals(
        pkg.bin,
        undefined,
        'platform packages must not declare a bin (would collide with the launcher shim)',
      )
      assertEquals(pkg.publishConfig, { access: 'public', provenance: true })
      if (entry.libc !== undefined) {
        assertEquals(pkg.libc, [entry.libc])
      } else {
        assertEquals(pkg.libc, undefined)
      }
      assertEquals(
        pkg.binarySha256,
        undefined,
        'no binarySha256 without the flag',
      )
    })
    await Promise.all(cases)
  })
})

Deno.test('generate-platform-manifest records binarySha256 when passed', async () => {
  await withTmp(async (tmp) => {
    const out = join(tmp, 'gen-sha')
    const res = await runScript('generate-platform-manifest.ts', [
      '--suffix',
      'linux-x64',
      '--version',
      '0.1.0',
      '--binary-sha256',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '--out',
      out,
    ], { writeAllow: out })
    assertEquals(res.code, 0, decode(res.stderr))
    const pkg = JSON.parse(await Deno.readTextFile(join(out, 'package.json')))
    assertEquals(
      pkg.binarySha256,
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    )
  })
})

Deno.test('generate-platform-manifest --dry-run leaves the filesystem untouched', async () => {
  await withTmp(async (tmp) => {
    const out = join(tmp, 'dry-run-out')
    const res = await runScript('generate-platform-manifest.ts', [
      '--suffix',
      'linux-x64',
      '--version',
      '0.1.0',
      '--out',
      out,
      '--dry-run',
    ])
    assertEquals(res.code, 0, decode(res.stderr))
    await assertRejects(() => Deno.stat(out))
    const stdout = decode(res.stdout)
    assertMatch(
      stdout,
      /"name": "@systemfsoftware\/claude-code-comment-checker-linux-x64"/,
    )
    assertMatch(stdout, /"version": "0.1.0"/)
  })
})

Deno.test('generate-platform-manifest: unknown suffix exits non-zero and lists the supported suffixes', async () => {
  await withTmp(async (tmp) => {
    const out = join(tmp, 'gen-unknown')
    const res = await runScript('generate-platform-manifest.ts', [
      '--suffix',
      'linux-mips',
      '--version',
      '0.1.0',
      '--out',
      out,
    ], { writeAllow: out })
    assertNotEquals(res.code, 0)
    const stderr = decode(res.stderr)
    for (const suffix of EXPECTED_SUFFIXES) {
      assertMatch(stderr, new RegExp(suffix))
    }
    await assertRejects(() => Deno.stat(join(out, 'package.json')))
  })
})

Deno.test('sync-root-version: VERSION=0.1.0 writes version and optionalDependencies via --manifest-path', async () => {
  await withTmp(async (tmp) => {
    const copy = join(tmp, 'manifest-copy.json')
    await Deno.copyFile(MANIFEST_PATH, copy)

    const res = await runScript('sync-root-version.ts', [
      '--manifest-path',
      copy,
    ], {
      env: { VERSION: '0.1.0' },
      writeAllow: copy,
    })
    assertEquals(res.code, 0, decode(res.stderr))

    const manifest = JSON.parse(await Deno.readTextFile(copy))
    assertEquals(manifest.version, '0.1.0')
    assertEquals(
      Object.keys(manifest.optionalDependencies).sort(),
      [...EXPECTED_SUFFIXES].sort().map((s) => `${LAUNCHER_PREFIX}-${s}`),
    )
    for (const value of Object.values(manifest.optionalDependencies)) {
      assertEquals(value, '0.1.0')
    }
    // The committed manifest is not touched by the release-time sync.
    const committed = JSON.parse(await Deno.readTextFile(MANIFEST_PATH))
    assertEquals(committed.optionalDependencies, undefined)
  })
})

Deno.test('sync-root-version: VERSION=0.2.0 dry-run shows only version-field diffs', async () => {
  await withTmp(async (tmp) => {
    const copy = join(tmp, 'manifest-copy2.json')
    await Deno.copyFile(MANIFEST_PATH, copy)
    // Seed the copy at 0.1.0 so the dry-run shift is a clean version bump.
    await runScript('sync-root-version.ts', ['--manifest-path', copy], {
      env: { VERSION: '0.1.0' },
      writeAllow: copy,
    })
    const before = await Deno.readTextFile(copy)

    const res = await runScript('sync-root-version.ts', [
      '--manifest-path',
      copy,
      '--dry-run',
    ], {
      env: { VERSION: '0.2.0' },
      writeAllow: copy,
    })
    assertEquals(res.code, 0, decode(res.stderr))
    assertEquals(await Deno.readTextFile(copy), before, 'dry-run never writes')

    const stdout = decode(res.stdout)
    const minus = stdout.split('\n').filter((line) => line.startsWith('- '))
    const plus = stdout.split('\n').filter((line) => line.startsWith('+ '))
    const manifest = JSON.parse(before)
    const changedLineCount = Object.keys(manifest.optionalDependencies).length +
      1 // version + five deps
    assertEquals(minus.length, changedLineCount)
    assertEquals(plus.length, changedLineCount)
    assertMatch(minus[0], /- {3}"version": "0.1.0",/)
    assertMatch(plus[0], /\+ {3}"version": "0.2.0",/)
    for (let i = 0; i < minus.length; i++) {
      const minusLine = minus[i].replace(/^- /, '')
      const plusLine = plus[i].replace(/^\+ /, '')
      assertEquals(
        plusLine,
        minusLine.replace('"0.1.0"', '"0.2.0"'),
        `each diff pair changes only the version value (line ${i}: ${minus[i]})`,
      )
    }
  })
})

Deno.test('sync-root-version: malformed VERSION exits non-zero and writes nothing', async () => {
  const malformed = [
    'v0.1.0',
    'v0.1.0"',
    '0.1.0\n--provenance=false',
    'not-a-version',
  ]
  const cases = malformed.map((version) =>
    withTmp(async (tmp) => {
      const copy = join(tmp, 'manifest-malformed.json')
      await Deno.copyFile(MANIFEST_PATH, copy)
      const before = await Deno.readTextFile(copy)
      const res = await runScript('sync-root-version.ts', [
        '--manifest-path',
        copy,
      ], {
        env: { VERSION: version },
        writeAllow: copy,
      })
      assertNotEquals(
        res.code,
        0,
        `VERSION=${JSON.stringify(version)} must fail`,
      )
      const stderr = decode(res.stderr)
      assertMatch(
        stderr,
        /invalid VERSION/,
        `stderr reports the invalid value for ${JSON.stringify(version)}: ${stderr}`,
      )
      assertEquals(
        await Deno.readTextFile(copy),
        before,
        `no write for VERSION=${JSON.stringify(version)}`,
      )
    })
  )
  await Promise.all(cases)
})

Deno.test('check-matrix: passes on the packaged table and pre-publish launcher manifest', async () => {
  const res = await runScript('check-matrix.ts', [])
  assertEquals(res.code, 0, decode(res.stderr))
  const stderr: string = decode(res.stderr)
  assertMatch(
    stderr,
    /no optionalDependencies \(pre-publish\)/,
    'absence of pins is noted, not failed',
  )
})

Deno.test('check-matrix: fails on a manifest with wrong pin', async () => {
  await withTmp(async (tmp) => {
    const copy = join(tmp, 'manifest-wrongpin.json')
    await Deno.copyFile(MANIFEST_PATH, copy)
    await runScript('sync-root-version.ts', ['--manifest-path', copy], {
      env: { VERSION: '0.1.0' },
      writeAllow: copy,
    })
    // Corrupt one pin to a different exact version after the sync.
    const manifest = JSON.parse(await Deno.readTextFile(copy))
    manifest.optionalDependencies[`${LAUNCHER_PREFIX}-linux-x64`] = '0.2.0'
    await Deno.writeTextFile(copy, JSON.stringify(manifest, null, 2) + '\n')

    const res = await runScript('check-matrix.ts', ['--manifest-path', copy])
    assertNotEquals(res.code, 0)
    assertMatch(decode(res.stderr), /FAIL/, 'stderr names the failure')
  })
})

Deno.test('check-matrix: fails on a reversed os/cpu identity violation', async () => {
  await withTmp(async (tmp) => {
    const table = await readTable()
    const reversed = table.map(({ target, suffix, os, cpu, libc, bin }) => ({
      target,
      suffix,
      os: cpu,
      cpu: os,
      bin,
      ...(libc !== undefined ? { libc } : {}),
    }))
    const targetsPath = join(tmp, 'targets.json')
    await Deno.writeTextFile(
      targetsPath,
      JSON.stringify(reversed, null, 2) + '\n',
    )
    const res = await runScript('check-matrix.ts', ['--targets', targetsPath])
    assertNotEquals(res.code, 0)
    assertMatch(decode(res.stderr), /FAIL/)
  })
})

Deno.test('check-matrix: fails on a missing or extra table target', async () => {
  await withTmp(async (tmp) => {
    const table = await readTable()

    const missingPath = join(tmp, 'missing.json')
    await Deno.writeTextFile(
      missingPath,
      JSON.stringify(
        table.filter((entry) => entry.target !== 'x86_64-apple-darwin'),
        null,
        2,
      ) +
        '\n',
    )
    const resMissing = await runScript('check-matrix.ts', [
      '--targets',
      missingPath,
    ])
    assertNotEquals(resMissing.code, 0)
    assertMatch(decode(resMissing.stderr), /FAIL/)

    const extraPath = join(tmp, 'extra.json')
    await Deno.writeTextFile(
      extraPath,
      JSON.stringify(
        [
          ...table,
          {
            target: 'x86_64-unknown-freebsd',
            suffix: 'freebsd-x64',
            os: 'freebsd',
            cpu: 'x64',
            bin: 'comment-checker',
          },
        ],
        null,
        2,
      ) + '\n',
    )
    const resExtra = await runScript('check-matrix.ts', [
      '--targets',
      extraPath,
    ])
    assertNotEquals(resExtra.code, 0)
    assertMatch(decode(resExtra.stderr), /FAIL/)
  })
})

// --- Workflow-agreement failure arms (F9): every gate fails loudly; a green
// check-matrix must imply table <-> workflow agreement in BOTH directions,
// including target/suffix pairing (a swapped suffix must not pass).

const WORKFLOW_ROW = (target: string, suffix: string) =>
  `        - target: ${target}\n          suffix: ${suffix}\n`

Deno.test('check-matrix: fails when the workflow omits a table target', async () => {
  await withTmp(async (tmp) => {
    const wf = join(tmp, 'release-missing.yml')
    const table = await readTable()
    const kept = table.filter((t) => t.target !== 'x86_64-apple-darwin')
    await Deno.writeTextFile(
      wf,
      '  strategy:\n    matrix:\n      include:\n' +
        kept.map((t) => WORKFLOW_ROW(t.target, t.suffix)).join('') +
        '\n',
    )
    const res = await runScript('check-matrix.ts', ['--workflow-path', wf])
    assertNotEquals(res.code, 0)
    assertMatch(decode(res.stderr), /FAIL/)
    assertMatch(decode(res.stderr), /x86_64-apple-darwin/)
  })
})

Deno.test('check-matrix: fails when the workflow names an extra target', async () => {
  await withTmp(async (tmp) => {
    const wf = join(tmp, 'release-extra.yml')
    const table = await readTable()
    await Deno.writeTextFile(
      wf,
      '  strategy:\n    matrix:\n      include:\n' +
        table.map((t) => WORKFLOW_ROW(t.target, t.suffix)).join('') +
        WORKFLOW_ROW('x86_64-unknown-freebsd', 'freebsd-x64') +
        '\n',
    )
    const res = await runScript('check-matrix.ts', ['--workflow-path', wf])
    assertNotEquals(res.code, 0)
    assertMatch(decode(res.stderr), /FAIL/)
    assertMatch(decode(res.stderr), /x86_64-unknown-freebsd/)
  })
})

Deno.test('check-matrix: fails on a swapped target/suffix pair', async () => {
  await withTmp(async (tmp) => {
    const wf = join(tmp, 'release-swapped.yml')
    const table = await readTable()
    const rows = table.map((t) => [
      t.target,
      t.target === 'x86_64-unknown-linux-gnu' ? 'linux-arm64' : t.suffix,
    ])
    await Deno.writeTextFile(
      wf,
      '  strategy:\n    matrix:\n      include:\n' +
        rows.map(([t, s]) => WORKFLOW_ROW(t, s)).join('') +
        '\n',
    )
    const res = await runScript('check-matrix.ts', ['--workflow-path', wf])
    assertNotEquals(res.code, 0)
    assertMatch(decode(res.stderr), /FAIL/)
  })
})

// --- parseFlags error paths (F10): malformed CLIs must exit non-zero before
// any write, never silently coerce a flag into a value slot. ---
const BAD_ARGS: Array<[string, string[], RegExp]> = [
  ['missing value', ['--suffix'], /missing value for --suffix/],
  [
    'flag-shaped value',
    ['--suffix', '--dry-run'],
    /missing value for --suffix/,
  ],
  ['unknown flag', ['--nope'], /unknown argument: --nope/],
  ['positional argument', ['naked'], /unknown argument: naked/],
]

for (const [label, args, pattern] of BAD_ARGS) {
  Deno.test(`parseFlags: ${label} exits non-zero without writing`, async () => {
    await withTmp(async (tmp) => {
      const res = await runScript('generate-platform-manifest.ts', [
        ...args,
        '--version',
        '0.1.0',
        '--out',
        tmp,
      ])
      assertNotEquals(res.code, 0)
      assertMatch(decode(res.stderr), pattern)
      // No package.json may be produced by a failed parse.
      await assertRejects(() => Deno.lstat(join(tmp, 'package.json')))
    })
  })
}

Deno.test('parseFlags: --flag=value form still admits dash-leading values', async () => {
  await withTmp(async (tmp) => {
    const out = join(tmp, 'eq-form')
    const res = await runScript('generate-platform-manifest.ts', [
      '--suffix=linux-x64',
      '--version=0.1.0',
      '--out',
      out,
    ], { writeAllow: out })
    assertEquals(res.code, 0, decode(res.stderr))
    const pkg = JSON.parse(
      await Deno.readTextFile(join(out, 'package.json')),
    )
    assertEquals(pkg.name, `${LAUNCHER_PREFIX}-linux-x64`)
  })
})

// --- Workflow/deno-task fidelity (F7): the exact permission surface the
// release pipeline declares must keep matching the scripts' real needs.
// These assertions replay the declared flags from the committed files — any
// drift (e.g. an env read without --allow-env) fails here, not at a tag. ---
Deno.test('fidelity: release.yml sync-root step declares --allow-env', async () => {
  const workflow = await Deno.readTextFile(RELEASE_WORKFLOW_PATH)
  const syncBlock =
    /- name: Sync root version[^]*?deno run[^\n]*\n((?:.*?\n)*?)\s*scripts\/release\/sync-root-version\.ts/
  const match = syncBlock.exec(workflow)
  assertNotEquals(match, null, 'sync-root step not found')
  assertMatch(match![1], /--allow-env/)
})

Deno.test('fidelity: manifest:sync-root task declares --allow-env', async () => {
  const config = await Deno.readTextFile(
    join(import.meta.dirname!, '..', '..', 'scripts', 'deno.jsonc'),
  )
  assertMatch(config, /"manifest:sync-root":[^\n]*--allow-env/)
})

Deno.test('fidelity: registry gate never regresses to the fromjson bug', async () => {
  const workflow = await Deno.readTextFile(RELEASE_WORKFLOW_PATH)
  assertFalse(
    workflow.includes('fromjson'),
    'jq gate must compare --argjson objects directly',
  )
})
