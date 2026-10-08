#!/usr/bin/env -S deno run --allow-read
import { resolve } from '@std/path'
import { parse as parseYaml } from '@std/yaml'
import { Schema } from 'effect'
import { parseCliArgs } from '../lib/cli.ts'
import { DEPENDABOT_PATH, PNPM_LOCK_PATH } from '../lib/shared.ts'

const NODE_TYPES_LTS_MAJOR = 24
const LAUNCHER_DIRECTORY = '/npm/packages/comment-checker'
const MAJOR_IGNORED = ['typescript', '@types/node']
const SEMVER_MAJOR = 'version-update:semver-major'

const ResolutionMap = Schema.Record(Schema.String, Schema.Unknown)
const Lockfile = Schema.Struct({ packages: ResolutionMap, snapshots: ResolutionMap })
const IgnoreRule = Schema.Struct({
  'dependency-name': Schema.String,
  'update-types': Schema.optionalKey(Schema.Array(Schema.String)),
})
const UpdateEntry = Schema.Struct({
  'package-ecosystem': Schema.String,
  directory: Schema.optionalKey(Schema.String),
  ignore: Schema.optionalKey(Schema.Array(IgnoreRule)),
})
const DependabotConfig = Schema.Struct({ updates: Schema.Array(UpdateEntry) })

const failures: string[] = []
const fail = (reason: string) => failures.push(reason)

const flags = parseCliArgs({
  string: ['lockfile', 'dependabot'],
})
const lockfilePath = typeof flags.lockfile === 'string' ? resolve(flags.lockfile) : PNPM_LOCK_PATH
const dependabotPath = typeof flags.dependabot === 'string'
  ? resolve(flags.dependabot)
  : DEPENDABOT_PATH

async function readYamlOrExit(path: string, label: string): Promise<unknown> {
  try {
    return parseYaml(await Deno.readTextFile(path))
  } catch (error) {
    console.error(
      `check-dep-pins: FAIL: cannot read ${label} ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    Deno.exit(1)
  }
}

const withoutPeerSuffix = (key: string) => key.split('(')[0]

function resolvedVersionsOf(name: string, lockfile: typeof Lockfile.Type): Set<string> {
  const versions = new Set<string>()
  const keys = [...Object.keys(lockfile.packages), ...Object.keys(lockfile.snapshots)]
  for (const key of keys.map(withoutPeerSuffix)) {
    const at = key.lastIndexOf('@')
    if (at > 0 && key.slice(0, at) === name) versions.add(key.slice(at + 1))
  }
  return versions
}

function checkLockfile(raw: unknown) {
  if (!Schema.is(Lockfile)(raw)) {
    fail('pnpm-lock.yaml has no packages/snapshots maps')
    return
  }
  const versions = resolvedVersionsOf('@types/node', raw)
  if (versions.size === 0) {
    fail('pnpm-lock.yaml resolves no @types/node; the pin cannot be confirmed')
  }
  for (const version of versions) {
    if (Number(version.split('.')[0]) !== NODE_TYPES_LTS_MAJOR) {
      fail(
        `pnpm-lock.yaml resolves @types/node@${version}; only ${NODE_TYPES_LTS_MAJOR}.x is allowed`,
      )
    }
  }
}

function checkDependabot(raw: unknown) {
  if (!Schema.is(DependabotConfig)(raw)) {
    fail('dependabot.yml does not parse as an updates list')
    return
  }
  const entry = raw.updates.find((update) =>
    update['package-ecosystem'] === 'npm' && update.directory === LAUNCHER_DIRECTORY
  )
  if (entry === undefined) {
    fail(`dependabot.yml has no npm entry for ${LAUNCHER_DIRECTORY}`)
    return
  }
  for (const name of MAJOR_IGNORED) {
    const blocked = (entry.ignore ?? []).some((rule) =>
      rule['dependency-name'] === name && (rule['update-types'] ?? []).includes(SEMVER_MAJOR)
    )
    if (!blocked) {
      fail(`dependabot.yml ${LAUNCHER_DIRECTORY} entry does not ignore ${name} ${SEMVER_MAJOR}`)
    }
  }
}

checkLockfile(await readYamlOrExit(lockfilePath, 'lockfile'))
checkDependabot(await readYamlOrExit(dependabotPath, 'dependabot config'))

if (failures.length > 0) {
  for (const reason of failures) {
    console.error(`check-dep-pins: FAIL: ${reason}`)
  }
  Deno.exit(1)
}

console.error('check-dep-pins: ok')
