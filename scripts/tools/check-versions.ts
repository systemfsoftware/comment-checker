#!/usr/bin/env -S deno run --allow-read --allow-env

import { runMain } from '@effect/platform-deno/DenoRuntime'
import { layer as DenoPlatform } from '@effect/platform-deno/DenoServices'
import { Console, Effect, FileSystem } from 'effect'

import {
  CRATES_DIR,
  extractJsonVersion,
  extractNixVersion,
  extractTomlVersion,
  FLAKE_NIX,
  MANIFEST,
  PLUGIN_MANIFEST,
  ROOT_MANIFEST,
  VersionMismatch,
  WORKSPACE_CARGO,
} from '../lib/version-sync.ts'

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const npmText = yield* fs.readFileString(MANIFEST)
  const npmVersion = yield* extractJsonVersion(npmText, MANIFEST)

  const workspaceText = yield* fs.readFileString(WORKSPACE_CARGO)
  const workspaceVersion = yield* extractTomlVersion(
    workspaceText,
    '[workspace.package]',
    WORKSPACE_CARGO,
  )

  const mismatches: Array<string> = []
  if (workspaceVersion !== npmVersion) {
    mismatches.push(`Cargo.toml workspace ${workspaceVersion} != npm ${npmVersion}`)
  }

  const crateNames = yield* fs.readDirectory(CRATES_DIR)
  for (const name of crateNames) {
    const path = `${CRATES_DIR}/${name}/Cargo.toml`
    if (!(yield* fs.exists(path))) continue
    const text = yield* fs.readFileString(path)
    const crateVersion = yield* extractTomlVersion(text, '[package]', path)
    if (crateVersion !== npmVersion) {
      mismatches.push(`${path} ${crateVersion} != npm ${npmVersion}`)
    }
  }

  if (yield* fs.exists(FLAKE_NIX)) {
    const nixText = yield* fs.readFileString(FLAKE_NIX)
    const nixVersion = yield* extractNixVersion(nixText, FLAKE_NIX)
    if (nixVersion !== npmVersion) {
      mismatches.push(`flake.nix ${nixVersion} != npm ${npmVersion}`)
    }
  }

  if (yield* fs.exists(ROOT_MANIFEST)) {
    const rootText = yield* fs.readFileString(ROOT_MANIFEST)
    const rootVersion = yield* extractJsonVersion(rootText, ROOT_MANIFEST)
    if (rootVersion !== npmVersion) {
      mismatches.push(`package.json root ${rootVersion} != npm ${npmVersion}`)
    }
  }

  let pluginChecked = false
  if (yield* fs.exists(PLUGIN_MANIFEST)) {
    const pluginText = yield* fs.readFileString(PLUGIN_MANIFEST)
    const pluginVersion = yield* extractJsonVersion(pluginText, PLUGIN_MANIFEST)
    if (pluginVersion !== npmVersion) {
      mismatches.push(`${PLUGIN_MANIFEST} ${pluginVersion} != npm ${npmVersion}`)
    }
    pluginChecked = true
  }

  if (mismatches.length > 0) {
    return yield* new VersionMismatch({ mismatches })
  }

  yield* Console.log(
    pluginChecked
      ? `check-versions: ok npm=${npmVersion} workspace=${workspaceVersion}`
      : `check-versions: ok npm=${npmVersion} workspace=${workspaceVersion} (plugin manifest: none tracked)`,
  )
})

runMain(program.pipe(Effect.provide(DenoPlatform)))
