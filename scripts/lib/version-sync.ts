import { parse as parseToml, stringify as stringifyToml } from '@std/toml'
import { parse as parseYaml } from '@std/yaml'
import { Effect, Schema } from 'effect'

export const Semver = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/))
export type Semver = typeof Semver.Type

export const Bump = Schema.Literals(['major', 'minor', 'patch', 'none'])
export type Bump = typeof Bump.Type

export const ReleaseBump = Schema.Literals(['major', 'minor', 'patch'])
export type ReleaseBump = typeof ReleaseBump.Type

export const TomlHeader = Schema.Literals(['[workspace.package]', '[package]'])
export type TomlHeader = typeof TomlHeader.Type

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
  expected: Semver,
  diffs: Schema.Array(Schema.Struct({
    path: Schema.String,
    found: Semver,
  })),
}) {
  override get message(): string {
    return this.diffs
      .map((d) => `check-versions: ${d.path} ${d.found} != npm ${this.expected}`)
      .join('\n')
  }
}

export class TomlParseFailed extends Schema.TaggedError<TomlParseFailed>()('TomlParseFailed', {
  path: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `TOML parse failed for ${this.path}: ${this.detail}`
  }
}

export class YamlParseFailed extends Schema.TaggedError<YamlParseFailed>()('YamlParseFailed', {
  path: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `YAML parse failed for ${this.path}: ${this.detail}`
  }
}

export class ChangesetParseFailed
  extends Schema.TaggedError<ChangesetParseFailed>()('ChangesetParseFailed', {
    path: Schema.String,
  }) {
  override get message(): string {
    return `changeset is not YAML frontmatter: ${this.path}`
  }
}

const Versioned = Schema.Struct({ version: Semver })
const WorkspaceToml = Schema.Struct({
  workspace: Schema.Struct({
    package: Versioned,
  }),
})
const PackageToml = Schema.Struct({
  package: Versioned,
})
const JsonDocument = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown), {
  space: 2,
})
const ChangesetFrontmatter = Schema.Record(Schema.String, Bump)
const nixVersionBindings = (
  text: string,
) => [...text.matchAll(/^\s*version\s*=\s*"(\d+\.\d+\.\d+)"\s*;?\s*$/gm)]

export const MANIFEST = 'npm/packages/comment-checker/package.json'
export const CHANGELOG = 'npm/packages/comment-checker/CHANGELOG.md'
export const WORKSPACE_CARGO = 'Cargo.toml'
export const ROOT_MANIFEST = 'package.json'
export const FLAKE_NIX = 'flake.nix'
export const PLUGIN_MANIFEST = '.claude-plugin/plugin.json'
export const CRATES_DIR = 'crates'
export const CHANGESET_DIR = './.changeset'

export const RANK: { readonly [K in ReleaseBump]: number } = { patch: 1, minor: 2, major: 3 }

const decodeToml = (text: string, path: string) =>
  Effect.try({
    try: () => parseToml(text),
    catch: (cause) => new TomlParseFailed({ path, detail: String(cause) }),
  })

export const extractJsonVersion = (text: string, path: string) =>
  Effect.gen(function* () {
    const doc = yield* Schema.decodeUnknownEffect(JsonDocument)(text).pipe(
      Effect.mapError(() => new MissingVersion({ path })),
    )
    const row = yield* Schema.decodeUnknownEffect(Versioned)(doc).pipe(
      Effect.mapError(() => new MissingVersion({ path })),
    )
    return row.version
  })

export const replaceJsonVersion = (text: string, next: Semver, path: string) =>
  Effect.gen(function* () {
    const doc = yield* Schema.decodeUnknownEffect(JsonDocument)(text).pipe(
      Effect.mapError(() => new MissingVersion({ path })),
    )
    yield* Schema.decodeUnknownEffect(Versioned)(doc).pipe(
      Effect.mapError(() => new MissingVersion({ path })),
    )
    const encoded = yield* Schema.encodeUnknownEffect(JsonDocument)({ ...doc, version: next })
    return encoded.endsWith('\n') ? encoded : `${encoded}\n`
  })

export const extractTomlVersion = (text: string, header: TomlHeader, path: string) =>
  Effect.gen(function* () {
    const parsed = yield* decodeToml(text, path)
    if (header === '[workspace.package]') {
      if (!Schema.is(WorkspaceToml)(parsed)) return yield* new MissingVersion({ path, header })
      return parsed.workspace.package.version
    }
    if (!Schema.is(PackageToml)(parsed)) return yield* new MissingVersion({ path, header })
    return parsed.package.version
  })

export const replaceTomlVersion = (text: string, header: TomlHeader, next: Semver, path: string) =>
  Effect.gen(function* () {
    const parsed = yield* decodeToml(text, path)
    if (header === '[workspace.package]') {
      if (!Schema.is(WorkspaceToml)(parsed)) return yield* new MissingVersion({ path, header })
      Object.assign(parsed.workspace.package, { version: next })
      return stringifyToml(parsed)
    }
    if (!Schema.is(PackageToml)(parsed)) return yield* new MissingVersion({ path, header })
    Object.assign(parsed.package, { version: next })
    return stringifyToml(parsed)
  })
export const extractNixVersion = (text: string, path: string) =>
  Effect.gen(function* () {
    const hits = nixVersionBindings(text)
    if (hits.length === 0) return yield* new MissingVersion({ path })
    if (hits.length > 1) return yield* new AmbiguousNixVersion({ path })
    return yield* Schema.decodeUnknownEffect(Semver)(hits[0][1])
  })

export const replaceNixVersion = (text: string, next: Semver, path: string) =>
  Effect.gen(function* () {
    const current = yield* extractNixVersion(text, path)
    const hits = nixVersionBindings(text)
    const hit = hits[0]
    const index = hit.index
    if (index === undefined) return yield* new MissingVersion({ path })
    return `${text.slice(0, index)}${hit[0].replace(current, next)}${
      text.slice(index + hit[0].length)
    }`
  })

export const nextVersion = (version: Semver, bump: ReleaseBump) => {
  const [major, minor, patch] = version.split('.').map(Number)
  const raw = bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`
  return Schema.decodeUnknownEffect(Semver)(raw)
}

export const parseChangeset = (body: string, path: string) =>
  Effect.gen(function* () {
    const parts = body.split(/^---$/m)
    if (parts.length < 3) return yield* new ChangesetParseFailed({ path })
    const raw = yield* Effect.try({
      try: () => parseYaml(parts[1] ?? ''),
      catch: (cause) => new YamlParseFailed({ path, detail: String(cause) }),
    })
    const frontmatter = yield* Schema.decodeUnknownEffect(ChangesetFrontmatter)(raw).pipe(
      Effect.mapError(() => new ChangesetParseFailed({ path })),
    )
    const bumps = Object.values(frontmatter)
    if (bumps.length === 0) return yield* new ChangesetParseFailed({ path })
    const releaseBumps = bumps.filter((b): b is ReleaseBump => b !== 'none')
    const summary = (parts[2] ?? '').trim().split('\n').join(' ')
    if (releaseBumps.length === 0) return { path, bump: 'none' as const, summary }
    const bump = releaseBumps.reduce((acc, b) => RANK[b] >= RANK[acc] ? b : acc)
    return { path, bump, summary }
  })
