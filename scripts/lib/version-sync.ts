import { Effect, FileSystem, Schema } from 'effect'

export const Semver = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/))
export type Semver = typeof Semver.Type

export const Bump = Schema.Literals(['major', 'minor', 'patch', 'none'])
export type Bump = typeof Bump.Type
export type ReleaseBump = Exclude<Bump, 'none'>

export class MissingVersion extends Schema.TaggedError<MissingVersion>()('MissingVersion', {
  path: Schema.String,
  header: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    return this.header !== undefined
      ? `no version found under ${this.header} in ${this.path}`
      : `no version field in ${this.path}`
  }
}

export class AmbiguousNixVersion
  extends Schema.TaggedError<AmbiguousNixVersion>()('AmbiguousNixVersion', {
    path: Schema.String,
  }) {
  override get message(): string {
    return `multiple version lines in ${this.path}`
  }
}

export class VersionMismatch extends Schema.TaggedError<VersionMismatch>()('VersionMismatch', {
  mismatches: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return this.mismatches.map((m) => `check-versions: ${m}`).join('\n')
  }
}

export const MANIFEST = 'npm/packages/comment-checker/package.json'
export const CHANGELOG = 'npm/packages/comment-checker/CHANGELOG.md'
export const WORKSPACE_CARGO = 'Cargo.toml'
export const ROOT_MANIFEST = 'package.json'
export const FLAKE_NIX = 'flake.nix'
export const PLUGIN_MANIFEST = '.claude-plugin/plugin.json'
export const CRATES_DIR = 'crates'
export const CHANGESET_DIR = './.changeset'

const JSON_VERSION = /"version"\s*:\s*"([^"]+)"/
const JSON_VERSION_ANY = /"version"\s*:\s*"[^"]*"/
const TOML_VERSION = /version\s*=\s*"([^"]+)"/
const TOML_VERSION_ANY = /version\s*=\s*"[^"]*"/

export const decodeSemver = (raw: string) => Schema.decodeUnknownEffect(Semver)(raw)
export const extractJsonVersion = (text: string, path: string) =>
  Effect.gen(function* () {
    const m = JSON_VERSION.exec(text)
    if (!m) return yield* new MissingVersion({ path })
    return yield* decodeSemver(m[1])
  })

export const replaceJsonVersion = (text: string, next: Semver, path: string) =>
  Effect.gen(function* () {
    if (!JSON_VERSION_ANY.test(text)) return yield* new MissingVersion({ path })
    return text.replace(JSON_VERSION_ANY, `"version": "${next}"`)
  })

export const extractTomlVersion = (text: string, header: string, path: string) =>
  Effect.gen(function* () {
    const lines = text.split('\n')
    let inTarget = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('[')) {
        inTarget = trimmed === header
      } else if (inTarget && trimmed.startsWith('version')) {
        const m = TOML_VERSION.exec(trimmed)
        if (!m) return yield* new MissingVersion({ path, header })
        return yield* decodeSemver(m[1])
      }
    }
    return yield* new MissingVersion({ path, header })
  })

export const replaceTomlVersion = (text: string, header: string, next: Semver, path: string) =>
  Effect.gen(function* () {
    const lines = text.split('\n')
    let inTarget = false
    let bumped = false
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('[')) {
        inTarget = trimmed === header
      } else if (inTarget && trimmed.startsWith('version')) {
        lines[i] = lines[i].replace(TOML_VERSION_ANY, `version = "${next}"`)
        bumped = true
        break
      }
    }
    if (!bumped) return yield* new MissingVersion({ path, header })
    return lines.join('\n')
  })

export const extractNixVersion = (text: string, path: string) =>
  Effect.gen(function* () {
    let found: string | undefined
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('version = "')) {
        const m = TOML_VERSION.exec(trimmed)
        if (!m) continue
        if (found !== undefined) return yield* new AmbiguousNixVersion({ path })
        found = m[1]
      }
    }
    if (found === undefined) return yield* new MissingVersion({ path })
    return yield* decodeSemver(found)
  })

export const replaceNixVersion = (text: string, next: Semver, path: string) =>
  Effect.gen(function* () {
    const lines = text.split('\n')
    let bumped = false
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('version = "')) {
        if (bumped) return yield* new AmbiguousNixVersion({ path })
        lines[i] = lines[i].replace(TOML_VERSION_ANY, `version = "${next}"`)
        bumped = true
      }
    }
    if (!bumped) return yield* new MissingVersion({ path })
    return lines.join('\n')
  })

export const nextVersion = (version: Semver, bump: Exclude<Bump, 'none'>) => {
  const [major, minor, patch] = version.split('.').map(Number)
  const raw = bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`
  return decodeSemver(raw)
}

export const bumpTomlFile = (path: string, header: string, next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const original = yield* fs.readFileString(path)
    const rewritten = yield* replaceTomlVersion(original, header, next, path)
    yield* fs.writeFileString(path, rewritten)
  })

export const bumpNixFile = (path: string, next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const original = yield* fs.readFileString(path)
    const rewritten = yield* replaceNixVersion(original, next, path)
    yield* fs.writeFileString(path, rewritten)
  })

export const bumpJsonFile = (path: string, next: Semver) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const original = yield* fs.readFileString(path)
    const rewritten = yield* replaceJsonVersion(original, next, path)
    yield* fs.writeFileString(path, rewritten)
  })

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
