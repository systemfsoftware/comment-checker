#!/usr/bin/env -S deno run --allow-read
import { join, resolve } from '@std/path'

const ROOT = join(import.meta.dirname!, '..', '..')
const DEFAULT_TARGETS_PATH = join(ROOT, 'scripts', 'release', 'targets.json')
const MANIFEST_PATH = join(ROOT, 'npm', 'packages', 'comment-checker', 'package.json')
const RELEASE_WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'release.yml')

// The supported platform set (KD1): the launcher resolves its platform package
// by identity as <launcher-name>-<platform>-<arch>. This is the product policy
// the table must name — a known set, not a copy of the table under check.
const EXPECTED_SUFFIXES = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64']

const failures: string[] = []
const fail = (reason: string) => failures.push(reason)
const note = (message: string) => console.error(`check-matrix: note: ${message}`)

// CLI: --targets <path> overrides the packaged table (defaults to
// scripts/release/targets.json); --manifest-path overrides the launcher
// manifest (defaults to npm/packages/comment-checker/package.json).
let targetsPath = DEFAULT_TARGETS_PATH
let manifestPath = MANIFEST_PATH
const args = Deno.args
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--targets') {
    const value = args[++i]
    if (value === undefined) {
      console.error('check-matrix: missing value for --targets')
      Deno.exit(1)
    }
    targetsPath = resolve(value)
  } else if (arg === '--manifest-path') {
    const value = args[++i]
    if (value === undefined) {
      console.error('check-matrix: missing value for --manifest-path')
      Deno.exit(1)
    }
    manifestPath = resolve(value)
  } else {
    console.error(`check-matrix: unknown argument: ${arg}`)
    Deno.exit(1)
  }
}

let targets: Array<
  { target: string; suffix: string; os: string; cpu: string; libc?: string; bin: string }
>
try {
  targets = JSON.parse(await Deno.readTextFile(targetsPath))
} catch (error) {
  console.error(
    `check-matrix: FAIL: cannot read targets file ${targetsPath}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  )
  Deno.exit(1)
}

// 1. Identity convention (KTD2): each entry must be self-consistent with the
// launcher's platform/arch naming — suffix "os-cpu", Windows bin .exe, libc on
// Linux only — and the table must name exactly the product platform set.
if (!Array.isArray(targets)) {
  fail('targets table is not an array')
} else {
  const suffixes = targets.map((t) => t.suffix)
  const missing = EXPECTED_SUFFIXES.filter((s) => !suffixes.includes(s))
  const extra = suffixes.filter((s) => !(EXPECTED_SUFFIXES as string[]).includes(s))
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `targets table must name exactly the supported platform set; missing: ${
        missing.join(', ') || 'none'
      }, extra: ${extra.join(', ') || 'none'}`,
    )
  }
  for (const entry of targets) {
    if (entry.suffix !== `${entry.os}-${entry.cpu}`) {
      fail(
        `target ${entry.target}: suffix "${entry.suffix}" must equal os-cpu "${entry.os}-${entry.cpu}"`,
      )
    }
    if ((entry.os === 'win32') !== (entry.bin === 'comment-checker.exe')) {
      fail(
        `target ${entry.target}: bin must be comment-checker.exe iff os is win32 (os: ${entry.os}, bin: ${entry.bin})`,
      )
    }
    if (entry.os === 'linux' && entry.libc !== 'glibc') {
      fail(
        `target ${entry.target}: linux targets must carry libc "glibc", got ${
          JSON.stringify(entry.libc)
        }`,
      )
    }
    if (entry.os !== 'linux' && entry.libc !== undefined) {
      fail(
        `target ${entry.target}: non-linux targets must not carry libc, got ${
          JSON.stringify(entry.libc)
        }`,
      )
    }
  }
}

// 2. Launcher manifest agreement: when optionalDependencies are present (the
//    publish-time sync-root-version run), they must be exactly the platform
//    packages named by this table, pinned to the root version. The committed
//    manifest carries none before the first release — pnpm cannot lock
//    unresolvable optional deps — so absence is expected, not a failure.
let manifest: Record<string, unknown> & {
  name: string
  version: string
  optionalDependencies?: Record<string, string>
}
try {
  manifest = JSON.parse(await Deno.readTextFile(manifestPath))
} catch (error) {
  console.error(
    `check-matrix: FAIL: cannot read launcher manifest ${manifestPath}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  )
  Deno.exit(1)
}

const expectedNames = targets.map((t) => `${manifest.name}-${t.suffix}`)
const declaredNames = Object.keys(manifest.optionalDependencies ?? {})
if (declaredNames.length === 0) {
  note(
    'launcher manifest carries no optionalDependencies (pre-publish); sync-root-version.ts injects the five platform pins from targets.json',
  )
} else {
  const missingNames = expectedNames.filter((name) => !declaredNames.includes(name))
  const extraNames = declaredNames.filter((name) => !expectedNames.includes(name))
  if (missingNames.length > 0 || extraNames.length > 0) {
    fail(
      `launcher manifest optionalDependencies must be exactly the platform packages from the table; missing: ${
        missingNames.join(', ') || 'none'
      }, extra: ${extraNames.join(', ') || 'none'}`,
    )
  }
  for (const name of expectedNames) {
    const pin = manifest.optionalDependencies?.[name]
    if (pin !== manifest.version) {
      fail(
        `optionalDependency ${name} must be pinned to the root version ${manifest.version}, got ${
          JSON.stringify(pin)
        }`,
      )
    }
  }
}

// 3. Cross-file agreement (the anti-drift surface): the workflow matrix must
//    name exactly the triples in the table, and vice versa. Absent workflow is
//    a skip (with a note), not a failure.
try {
  await Deno.lstat(RELEASE_WORKFLOW_PATH)
  const content = await Deno.readTextFile(RELEASE_WORKFLOW_PATH)
  // Only literal matrix include rows (target: <triple>) — env-var names like
  // CC_aarch64_unknown_linux_gnu or gcc-aarch64-linux-gnu are not rows.
  const workflowTargets = new Set(
    [...content.matchAll(/^\s*-\s*target:\s*((?:x86_64|aarch64)-[a-z0-9-]+)\s*$/gm)].map((m) =>
      m[1]
    ),
  )
  const tableTargets = new Set(targets.map((t) => t.target))
  for (const target of tableTargets) {
    if (!workflowTargets.has(target)) {
      fail(`release.yml does not list release target ${target}`)
    }
  }
  for (const target of workflowTargets) {
    if (!tableTargets.has(target)) {
      fail(`release.yml lists ${target}, which is not a row in targets.json`)
    }
  }
} catch {
  note(`skipped: ${RELEASE_WORKFLOW_PATH} not found (workflow agreement not checked)`)
}

if (failures.length > 0) {
  for (const reason of failures) {
    console.error(`check-matrix: FAIL: ${reason}`)
  }
  Deno.exit(1)
}

console.error('check-matrix: ok')
