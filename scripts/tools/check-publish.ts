#!/usr/bin/env -S deno run --allow-read --allow-env=NPM_REGISTRY --allow-net=registry.npmjs.org
import { parseCliArgs } from '../lib/cli.ts'
import { queryRegistry, readDistributionSet } from '../lib/distribution-set.ts'

const flags = parseCliArgs({
  boolean: ['check', 'json', 'preflight'],
  string: [],
})

const checkMode = flags.check === true
const jsonMode = flags.json === true
const preflightMode = flags.preflight === true

const registry = Deno.env.get('NPM_REGISTRY') ?? 'https://registry.npmjs.org'

const { launcher, packages } = await readDistributionSet()

interface PackageEvaluation {
  name: string
  kind: 'launcher' | 'platform'
  localVersion: string
  npmLatest: string
  status: 'published' | 'unpublished' | 'error'
  attested: boolean
  classification: 'unpublished' | 'no-oidc' | 'stuck' | 'ok' | 'error'
}

const evaluations: PackageEvaluation[] = []

for (const pkg of packages) {
  const snapshot = await queryRegistry(pkg.name, registry)
  const localVersion = pkg.kind === 'launcher' ? launcher.version : '—'
  const npmLatest = snapshot.latest ?? (snapshot.unpublished ? '—' : '?')
  const attested = snapshot.attested === true

  let classification: PackageEvaluation['classification']
  let status: PackageEvaluation['status']

  if (snapshot.unpublished) {
    status = 'unpublished'
    classification = 'unpublished'
  } else if (snapshot.status === 0 || snapshot.latest === undefined) {
    status = 'error'
    classification = 'error'
  } else {
    status = 'published'
    if (!attested) {
      classification = 'no-oidc'
    } else if (pkg.kind === 'launcher' && localVersion !== npmLatest) {
      classification = 'stuck'
    } else {
      classification = 'ok'
    }
  }

  evaluations.push({
    name: pkg.name,
    kind: pkg.kind,
    localVersion,
    npmLatest,
    status,
    attested,
    classification,
  })
}

if (jsonMode) {
  for (const item of evaluations) {
    Deno.stdout.writeSync(
      new TextEncoder().encode(
        JSON.stringify({
          name: item.name,
          kind: item.kind,
          local_version: item.localVersion,
          npm_latest: item.npmLatest,
          class: item.classification,
          attested: item.attested ? 'yes' : 'no',
        }) + '\n',
      ),
    )
  }
} else {
  const count = (cls: PackageEvaluation['classification']) =>
    evaluations.filter((e) => e.classification === cls).length

  const unpublishedCount = count('unpublished')
  const noOidcCount = count('no-oidc')
  const stuckCount = count('stuck')
  const okCount = count('ok')
  const errorCount = count('error')

  const lines: string[] = [
    `npm publish status — ${new Date().toISOString()} — registry: ${registry}`,
    `distribution packages: ${evaluations.length}`,
    '',
    '== UNPUBLISHED (404 on npm) ==',
  ]

  for (const item of evaluations.filter((e) => e.classification === 'unpublished')) {
    lines.push(
      `  ${item.name.padEnd(60)} local ${item.localVersion.padEnd(8)} npm ${item.npmLatest}`,
    )
  }

  lines.push(
    '',
    '== PUBLISHED, NO OIDC ATTESTATION ==',
  )
  for (const item of evaluations.filter((e) => e.classification === 'no-oidc')) {
    lines.push(
      `  ${item.name.padEnd(60)} local ${item.localVersion.padEnd(8)} npm ${item.npmLatest}`,
    )
  }

  lines.push(
    '',
    '== PUBLISHED + ATTESTED, BUT LOCAL AHEAD ==',
  )
  for (const item of evaluations.filter((e) => e.classification === 'stuck')) {
    lines.push(
      `  ${item.name.padEnd(60)} local ${item.localVersion.padEnd(8)} npm ${item.npmLatest}`,
    )
  }

  lines.push(
    '',
    '== PUBLISHED + ATTESTED, CURRENT ==',
  )
  for (const item of evaluations.filter((e) => e.classification === 'ok')) {
    lines.push(
      `  ${item.name.padEnd(60)} local ${item.localVersion.padEnd(8)} npm ${item.npmLatest}`,
    )
  }

  lines.push(
    '',
    '== summary ==',
    `  unpublished: ${unpublishedCount}`,
    `  no-oidc:     ${noOidcCount}`,
    `  stuck:       ${stuckCount}`,
    `  ok:          ${okCount}`,
  )
  if (errorCount > 0) {
    lines.push(`  error:       ${errorCount}`)
  }

  Deno.stdout.writeSync(new TextEncoder().encode(lines.join('\n') + '\n'))
}

const unpublishedTotal = evaluations.filter((e) => e.classification === 'unpublished').length
const errorTotal = evaluations.filter((e) => e.classification === 'error').length
const noOidcTotal = evaluations.filter((e) => e.classification === 'no-oidc').length

if (preflightMode) {
  if (unpublishedTotal === 0 && errorTotal === 0) {
    Deno.stdout.writeSync(
      new TextEncoder().encode(
        '\nPREFLIGHT OK: every distribution package exists on the registry.\n',
      ),
    )
  } else {
    Deno.stderr.writeSync(
      new TextEncoder().encode(
        `\n::error::preflight failed — ${unpublishedTotal} package(s) have never been published, ${errorTotal} unqueryable. OIDC cannot debut a package; bootstrap each one from a maintainer machine, then re-run.\n`,
      ),
    )
    Deno.exit(1)
  }
}

if (checkMode) {
  if (unpublishedTotal > 0 || noOidcTotal > 0 || errorTotal > 0) {
    Deno.stderr.writeSync(
      new TextEncoder().encode(
        `\nFAIL: ${unpublishedTotal} unpublished, ${noOidcTotal} without OIDC attestation, ${errorTotal} unqueryable\n`,
      ),
    )
    Deno.exit(1)
  }
  Deno.stdout.writeSync(
    new TextEncoder().encode(
      '\nOK: every package is published and carries provenance attestations.\n',
    ),
  )
}
