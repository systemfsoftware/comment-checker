import { Effect, FileSystem } from 'effect'
import {
  CRATES_DIR,
  extractJsonVersion,
  extractNixVersion,
  extractTomlVersion,
  FLAKE_NIX,
  MANIFEST,
  PLUGIN_MANIFEST,
  replaceJsonVersion,
  replaceNixVersion,
  replaceTomlVersion,
  ROOT_MANIFEST,
  type Semver,
  VersionMismatch,
  WORKSPACE_CARGO,
} from './version-sync.ts'

const rewriteJson = (path: string, next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const original = yield* fs.readFileString(path)
    const rewritten = yield* replaceJsonVersion(original, next, path)
    yield* fs.writeFileString(path, rewritten)
  })

const rewriteToml = (
  path: string,
  header: '[workspace.package]' | '[package]',
  next: Semver,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const original = yield* fs.readFileString(path)
    const rewritten = yield* replaceTomlVersion(original, header, next, path)
    yield* fs.writeFileString(path, rewritten)
  })

const rewriteNix = (path: string, next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const original = yield* fs.readFileString(path)
    const rewritten = yield* replaceNixVersion(original, next, path)
    yield* fs.writeFileString(path, rewritten)
  })

export const bumpAllSurfaces = (next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* rewriteJson(MANIFEST, next)
    yield* rewriteToml(WORKSPACE_CARGO, '[workspace.package]', next)
    const names = yield* fs.readDirectory(CRATES_DIR)
    for (const name of names) {
      const path = `${CRATES_DIR}/${name}/Cargo.toml`
      if (yield* fs.exists(path)) yield* rewriteToml(path, '[package]', next)
    }
    yield* rewriteNix(FLAKE_NIX, next)
    yield* rewriteJson(ROOT_MANIFEST, next)
    if (!(yield* fs.exists(PLUGIN_MANIFEST))) return false
    yield* rewriteJson(PLUGIN_MANIFEST, next)
    return true
  })

export const checkAllSurfaces = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const npmText = yield* fs.readFileString(MANIFEST)
    const expected = yield* extractJsonVersion(npmText, MANIFEST)
    const diffs: Array<{ path: string; found: Semver }> = []

    const check = (path: string, found: Semver) => {
      if (found !== expected) diffs.push({ path, found })
    }

    const workspaceText = yield* fs.readFileString(WORKSPACE_CARGO)
    const workspaceVersion = yield* extractTomlVersion(
      workspaceText,
      '[workspace.package]',
      WORKSPACE_CARGO,
    )
    check(WORKSPACE_CARGO, workspaceVersion)

    const names = yield* fs.readDirectory(CRATES_DIR)
    for (const name of names) {
      const path = `${CRATES_DIR}/${name}/Cargo.toml`
      if (!(yield* fs.exists(path))) continue
      const text = yield* fs.readFileString(path)
      check(path, yield* extractTomlVersion(text, '[package]', path))
    }

    if (yield* fs.exists(FLAKE_NIX)) {
      const text = yield* fs.readFileString(FLAKE_NIX)
      check(FLAKE_NIX, yield* extractNixVersion(text, FLAKE_NIX))
    }

    if (yield* fs.exists(ROOT_MANIFEST)) {
      const text = yield* fs.readFileString(ROOT_MANIFEST)
      check(ROOT_MANIFEST, yield* extractJsonVersion(text, ROOT_MANIFEST))
    }

    let pluginChecked = false
    if (yield* fs.exists(PLUGIN_MANIFEST)) {
      const text = yield* fs.readFileString(PLUGIN_MANIFEST)
      check(PLUGIN_MANIFEST, yield* extractJsonVersion(text, PLUGIN_MANIFEST))
      pluginChecked = true
    }

    if (diffs.length > 0) return yield* new VersionMismatch({ expected, diffs })
    return { expected, workspaceVersion, pluginChecked }
  })
