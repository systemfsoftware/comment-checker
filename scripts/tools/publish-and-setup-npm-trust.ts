#!/usr/bin/env -S deno run --allow-run=git,npm,pnpm --allow-read --allow-write --allow-env=NPM_REGISTRY --allow-net=registry.npmjs.org
import { join } from '@std/path'
import { parseCliArgs } from '../lib/cli.ts'
import {
  type PackageTarget,
  queryRegistry,
  readDistributionSet,
  remoteSlugFromRepo,
} from '../lib/distribution-set.ts'
import { buildPlatformManifest } from '../lib/platform-manifest.ts'
import { LAUNCHER_MANIFEST_PATH } from '../lib/shared.ts'

const DUMMY_BOOTSTRAP_VERSION = '0.0.0-dummy-npm'

const flags = parseCliArgs({
  alias: { 'dry-run': 'dryRun', o: 'only' },
  boolean: ['dry-run'],
  string: ['only', 'jobs'],
})

const dryRun = flags.dryRun === true
const onlyArg = typeof flags.only === 'string' ? flags.only : ''
const selectedOnly: Record<string, true> = {}
for (const item of onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) {
  selectedOnly[item] = true
}

const hasOnly = Object.keys(selectedOnly).length > 0
const registry = Deno.env.get('NPM_REGISTRY') ?? 'https://registry.npmjs.org'

const repoRoot = new TextDecoder().decode(
  (await new Deno.Command('git', { args: ['rev-parse', '--show-toplevel'] }).output()).stdout,
).trim()

const slug = await remoteSlugFromRepo(repoRoot)
const { launcher, packages } = await readDistributionSet()

const targetPackages = packages.filter((p) => !hasOnly || selectedOnly[p.name] === true)

function logLine(msg: string) {
  console.log(msg)
}

function logError(msg: string) {
  console.error(`ERROR: ${msg}`)
}

async function runInteractive(args: string[], cwd: string): Promise<boolean> {
  const child = new Deno.Command(args[0], {
    args: args.slice(1),
    cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const status = await child.status
  return status.success
}

async function stageAndPublish(pkg: PackageTarget): Promise<{ name: string; ok: boolean }> {
  logLine(`\n== ${pkg.name}`)
  const stageDir = await Deno.makeTempDir({ prefix: 'comment-checker-bootstrap-' })

  try {
    if (pkg.kind === 'platform' && pkg.target) {
      const manifest = buildPlatformManifest(launcher, pkg.target, DUMMY_BOOTSTRAP_VERSION)
      await Deno.writeTextFile(
        join(stageDir, 'package.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      )
      await Deno.writeTextFile(join(stageDir, pkg.target.bin), '')
    } else {
      const original = JSON.parse(await Deno.readTextFile(LAUNCHER_MANIFEST_PATH))
      original.version = DUMMY_BOOTSTRAP_VERSION
      await Deno.writeTextFile(
        join(stageDir, 'package.json'),
        JSON.stringify(original, null, 2) + '\n',
      )
      await Deno.mkdir(join(stageDir, 'dist'), { recursive: true })
      await Deno.writeTextFile(join(stageDir, 'dist', 'index.mjs'), '')
    }

    const publishCmd = [
      'npm',
      'publish',
      '--access',
      'public',
      '--no-provenance',
      '--tag',
      'next',
    ]

    const trustCmd = [
      'npm',
      'trust',
      'github',
      pkg.name,
      '--repo',
      slug,
      '--file',
      'release.yml',
      '--allow-publish',
      '--yes',
    ]

    const listCmd = ['npm', 'trust', 'list', pkg.name]

    const steps = [
      { cmd: publishCmd, cwd: stageDir },
      { cmd: trustCmd, cwd: repoRoot },
      { cmd: listCmd, cwd: repoRoot },
    ]

    for (const step of steps) {
      logLine(`  > ${step.cmd.join(' ')}`)
      if (dryRun) continue
      const ok = await runInteractive(step.cmd, step.cwd)
      if (!ok) {
        logError(`Command failed: ${step.cmd.join(' ')}`)
        return { name: pkg.name, ok: false }
      }
    }
    return { name: pkg.name, ok: true }
  } finally {
    try {
      await Deno.remove(stageDir, { recursive: true })
    } catch {
      // Stage dir cleanup is non-fatal
    }
  }
}

logLine('Checking registry statuses...')
const unpublished: PackageTarget[] = []

for (const pkg of targetPackages) {
  const snapshot = await queryRegistry(pkg.name, registry)
  const is404 = snapshot.unpublished || snapshot.status === 404
  logLine(
    `  ${pkg.name.padEnd(60)} … ${
      is404 ? 'unpublished (404)' : `published (HTTP ${snapshot.status}) — skipped`
    }`,
  )
  if (is404) {
    unpublished.push(pkg)
  }
}

if (unpublished.length === 0) {
  logLine('\nNothing to publish: all packages already exist on the registry.')
  Deno.exit(0)
}

logLine(`\nBootstrapping and trusting ${unpublished.length} package(s)...`)

const results: { name: string; ok: boolean }[] = []
for (const pkg of unpublished) {
  results.push(await stageAndPublish(pkg))
}

const failed = results.filter((r) => !r.ok).map((r) => r.name)
if (failed.length > 0) {
  logError(`Failed bootstrap for: ${failed.join(', ')}`)
  Deno.exit(1)
}

logLine('\nDone: All debut packages published and trusted.')
