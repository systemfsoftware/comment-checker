#!/usr/bin/env -S deno run --allow-read
import { resolve } from '@std/path'
import { parseCliArgs } from '../lib/cli.ts'
import { matrixRows } from '../lib/matrix-rows.ts'
import {
  LAUNCHER_MANIFEST_PATH,
  type LauncherManifest,
  RELEASE_WORKFLOW_PATH,
  type Target,
  TARGETS_PATH,
} from '../lib/shared.ts'

// The product platform set: a known list the table must name, not a copy
// derived from the table under check.
const EXPECTED_SUFFIXES = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64']

// Known-good hosted runners. The release workflow's per-row runner must match
// the table's canonical runner AND be one of these — a retired or mistyped
// label (e.g. macos-13) must fail the gate, not pass it (issue #8 refit).
const KNOWN_RUNNERS = new Set(['ubuntu-latest', 'ubuntu-24.04-arm', 'macos-14', 'windows-2022'])

const failures: string[] = []
const fail = (reason: string) => failures.push(reason)
const note = (message: string) => console.error(`check-matrix: note: ${message}`)

const flags = parseCliArgs({
  alias: { 'manifest-path': 'manifestPath', 'workflow-path': 'workflowPath' },
  string: ['targets', 'manifest-path', 'workflow-path'],
})
const targetsPath = typeof flags.targets === 'string' ? resolve(flags.targets) : TARGETS_PATH
const manifestPath = typeof flags.manifestPath === 'string'
  ? resolve(flags.manifestPath)
  : LAUNCHER_MANIFEST_PATH
const workflowPath = typeof flags.workflowPath === 'string'
  ? resolve(flags.workflowPath)
  : RELEASE_WORKFLOW_PATH

async function readJsonOrExit(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path))
  } catch (error) {
    console.error(
      `check-matrix: FAIL: cannot read ${label} ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    Deno.exit(1)
  }
}

function checkTable(targets: Target[]) {
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
    if (!KNOWN_RUNNERS.has(entry.runner)) {
      fail(
        `target ${entry.target}: runner "${entry.runner}" is not a known runner; known are ${
          [...KNOWN_RUNNERS].join(', ')
        }`,
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

function checkManifest(manifest: LauncherManifest, targets: Target[]) {
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
}

async function checkWorkflow(workflowPath: string, targets: Target[]) {
  try {
    await Deno.lstat(workflowPath)
    const content = await Deno.readTextFile(workflowPath)
    // Typed YAML parse (issue #8): formatting variants (flow style, quoting,
    // key order) must not change what rows are seen, and any malformed or
    // empty matrix — or a missing release job — throws inside matrixRows and
    // fails the gate instead of yielding an empty match set.
    const workflowRows = matrixRows(content)
    const tableRows = new Map(targets.map((t) => [t.target, t]))
    if (workflowRows.length !== targets.length) {
      fail(
        `release.yml lists ${workflowRows.length} matrix rows; targets.json has ${targets.length}`,
      )
    }
    for (const row of workflowRows) {
      const entry = tableRows.get(row.target)
      if (!entry) {
        fail(`release.yml lists ${row.target}, which is not a row in targets.json`)
        continue
      }
      if (row.suffix !== entry.suffix) {
        fail(
          `release.yml lists ${row.target} with suffix ${row.suffix}, table says ${entry.suffix}`,
        )
      }
      if (row.runner !== entry.runner) {
        fail(
          `release.yml lists ${row.target} on runner ${row.runner}, table says ${entry.runner}`,
        )
      }
    }
    for (const entry of targets) {
      if (!workflowRows.some((row) => row.target === entry.target)) {
        fail(`release.yml does not list release target ${entry.target}`)
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      note(`skipped: ${workflowPath} not found (workflow agreement not checked)`)
    } else {
      fail(`cannot check workflow ${workflowPath}: ${String(error)}`)
    }
  }
}

const rawTargets = await readJsonOrExit(targetsPath, 'targets file')
if (!Array.isArray(rawTargets)) {
  fail('targets table is not an array')
} else {
  checkTable(rawTargets as Target[])
}
const rawManifest = await readJsonOrExit(manifestPath, 'launcher manifest')
checkManifest(rawManifest as LauncherManifest, rawTargets as Target[])
await checkWorkflow(workflowPath, rawTargets as Target[])

if (failures.length > 0) {
  for (const reason of failures) {
    console.error(`check-matrix: FAIL: ${reason}`)
  }
  Deno.exit(1)
}

console.error('check-matrix: ok')
