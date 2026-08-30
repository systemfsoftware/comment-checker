#!/usr/bin/env -S deno run --allow-read --allow-env --allow-write --allow-run=git,gh

import { runMain } from '@effect/platform-deno/DenoRuntime'
import { layer as DenoPlatform } from '@effect/platform-deno/DenoServices'
import { Console, Effect } from 'effect'
import { checkAllSurfaces } from '../lib/version-files.ts'

const program = Effect.gen(function* () {
  const { expected, workspaceVersion, pluginChecked, flakeHashes } = yield* checkAllSurfaces()
  if (flakeHashes.skipped) {
    yield* Console.log(`check-versions: flake hash gate skipped (${flakeHashes.skipped})`)
  } else {
    yield* Console.log(`check-versions: flake hash gate verified against live release assets`)
  }
  yield* Console.log(
    pluginChecked
      ? `check-versions: ok npm=${expected} workspace=${workspaceVersion}`
      : `check-versions: ok npm=${expected} workspace=${workspaceVersion} (plugin manifest: none tracked)`,
  )
})

runMain(Effect.scoped(program).pipe(Effect.provide(DenoPlatform)))
