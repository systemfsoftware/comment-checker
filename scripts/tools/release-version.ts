#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { runMain } from '@effect/platform-deno/DenoRuntime'
import { layer as DenoPlatform } from '@effect/platform-deno/DenoServices'
import { Console, Effect, FileSystem, Schema } from 'effect'

import {
  Bump,
  CHANGELOG,
  CHANGESET_DIR,
  extractJsonVersion,
  MANIFEST,
  nextVersion,
  type ReleaseBump,
} from '../lib/version-sync.ts'
import { bumpAllSurfaces } from '../lib/version-files.ts'

const RANK: Record<ReleaseBump, number> = { patch: 1, minor: 2, major: 3 }

const isReleaseBump = (bump: Bump): bump is ReleaseBump => bump !== 'none'

class Intent extends Schema.Class<Intent>('Intent')({
  path: Schema.String,
  bump: Bump,
  summary: Schema.String,
}) {}

const parseIntent = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const body = yield* fs.readFileString(path)
    const parts = body.split(/^---$/m)
    const rawBump = /:\s*(major|minor|patch|none)/.exec(parts[1] ?? '')?.[1] ?? ''
    const bump = yield* Schema.decodeUnknownEffect(Bump)(rawBump)
    const summary = (parts[2] ?? '').trim().split('\n').join(' ')
    return new Intent({ path, bump, summary })
  })

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const entries = yield* fs.readDirectory(CHANGESET_DIR)
  const pending = entries.filter((name) => name.endsWith('.md') && name !== 'README.md')
  if (pending.length === 0) {
    yield* Console.log('no change intents; nothing to version')
    return
  }

  const intents = yield* Effect.all(pending.map((name) => parseIntent(`${CHANGESET_DIR}/${name}`)))
  const releases = intents.filter((i) => isReleaseBump(i.bump))
  if (releases.length === 0) {
    for (const i of intents) yield* fs.remove(i.path)
    yield* Console.log('only none intents; consumed without version bump')
    return
  }

  const chosen = releases.sort((a, b) => {
    const aBump = a.bump as ReleaseBump
    const bBump = b.bump as ReleaseBump
    return RANK[bBump] - RANK[aBump]
  })[0]
  const bump = chosen.bump as ReleaseBump
  const summary = releases.map((i) => `  - ${i.summary}`).join('\n')
  const manifestText = yield* fs.readFileString(MANIFEST)
  const version = yield* extractJsonVersion(manifestText, MANIFEST)
  const next = yield* nextVersion(version, bump)

  const pluginBumped = yield* bumpAllSurfaces(next)
  if (!pluginBumped) {
    yield* Console.log('plugin manifest: none tracked — skipped')
  }

  const changelog = yield* fs.exists(CHANGELOG).pipe(
    Effect.flatMap((exists) =>
      exists ? fs.readFileString(CHANGELOG) : Effect.succeed('# Changelog\n')
    ),
  )
  yield* fs.writeFileString(
    CHANGELOG,
    `${changelog.trimEnd()}\n\n## ${next}\n\n${summary}\n`,
  )

  for (const i of intents) yield* fs.remove(i.path)
  yield* Console.log(`versioned packages to ${next}`)
})

runMain(program.pipe(Effect.provide(DenoPlatform)))
