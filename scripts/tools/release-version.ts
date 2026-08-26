#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { runMain } from '@effect/platform-deno/DenoRuntime'
import { layer as DenoPlatform } from '@effect/platform-deno/DenoServices'
import { Console, Effect, FileSystem } from 'effect'
import { bumpAllSurfaces } from '../lib/version-files.ts'
import {
  CHANGELOG,
  CHANGESET_DIR,
  extractJsonVersion,
  MANIFEST,
  nextVersion,
  parseChangeset,
  RANK,
  type ReleaseBump,
} from '../lib/version-sync.ts'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const entries = yield* fs.readDirectory(CHANGESET_DIR)
  const pending = entries.filter((name) => name.endsWith('.md') && name !== 'README.md')
  if (pending.length === 0) {
    yield* Console.log('no change intents; nothing to version')
    return
  }

  const intents = yield* Effect.all(
    pending.map((name) =>
      Effect.gen(function* () {
        const body = yield* fs.readFileString(`${CHANGESET_DIR}/${name}`)
        return yield* parseChangeset(body, `${CHANGESET_DIR}/${name}`)
      })
    ),
  )
  const releases = intents.filter((i): i is typeof i & { bump: ReleaseBump } => i.bump !== 'none')
  if (releases.length === 0) {
    for (const i of intents) yield* fs.remove(i.path)
    yield* Console.log('only none intents; consumed without version bump')
    return
  }

  const bump = releases.reduce((acc, i) => RANK[i.bump] >= RANK[acc.bump] ? i : acc).bump
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
