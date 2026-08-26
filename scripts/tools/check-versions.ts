#!/usr/bin/env -S deno run --allow-read --allow-env

import { runMain } from '@effect/platform-deno/DenoRuntime'
import { layer as DenoPlatform } from '@effect/platform-deno/DenoServices'
import { Console, Effect } from 'effect'
import { checkAllSurfaces } from '../lib/version-files.ts'

const program = Effect.gen(function* () {
  const { expected, workspaceVersion, pluginChecked } = yield* checkAllSurfaces()
  yield* Console.log(
    pluginChecked
      ? `check-versions: ok npm=${expected} workspace=${workspaceVersion}`
      : `check-versions: ok npm=${expected} workspace=${workspaceVersion} (plugin manifest: none tracked)`,
  )
})

runMain(program.pipe(Effect.provide(DenoPlatform)))
