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
  type TomlHeader,
  WORKSPACE_CARGO,
} from './version-sync.ts'

const rewrite = (
  path: string,
  next: (text: string) => Effect.Effect<string, unknown, never>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const original = yield* fs.readFileString(path)
    const rewritten = yield* next(original)
    yield* fs.writeFileString(path, rewritten)
  })

export const bumpTomlFile = (path: string, header: TomlHeader, next: Semver) =>
  rewrite(path, (text) => replaceTomlVersion(text, header, next, path))

export const bumpNixFile = (path: string, next: Semver) =>
  rewrite(path, (text) => replaceNixVersion(text, next, path))

export const bumpJsonFile = (path: string, next: Semver) =>
  rewrite(path, (text) => replaceJsonVersion(text, next, path))

export const bumpCrateTomls = (next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const names = yield* fs.readDirectory(CRATES_DIR)
    for (const name of names) {
      const path = `${CRATES_DIR}/${name}/Cargo.toml`
      if (yield* fs.exists(path)) {
        yield* bumpTomlFile(path, '[package]', next)
      }
    }
  })

export const bumpPluginIfPresent = (next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (!(yield* fs.exists(PLUGIN_MANIFEST))) return false
    yield* bumpJsonFile(PLUGIN_MANIFEST, next)
    return true
  })

export const bumpAllSurfaces = (next: Semver) =>
  Effect.gen(function* () {
    yield* bumpJsonFile(MANIFEST, next)
    yield* bumpTomlFile(WORKSPACE_CARGO, '[workspace.package]', next)
    yield* bumpCrateTomls(next)
    yield* bumpNixFile(FLAKE_NIX, next)
    yield* bumpJsonFile(ROOT_MANIFEST, next)
    return yield* bumpPluginIfPresent(next)
  })

export const readSurfaceVersion = (path: string, kind: 'json' | 'nix' | TomlHeader) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(path)
    if (kind === 'json') return yield* extractJsonVersion(text, path)
    if (kind === 'nix') return yield* extractNixVersion(text, path)
    return yield* extractTomlVersion(text, kind, path)
  })
