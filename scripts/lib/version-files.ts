import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { Crypto, Effect, FileSystem, Schema } from 'effect'
import { sriFromSha256, type Target, TARGETS_PATH, unixTargetTriples } from './shared.ts'
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
  Semver,
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

    const flakeHash = yield* checkFlakeHashes()
    if (flakeHash.stale.length > 0) {
      return yield* new FlakeHashMismatch({ version: expected, stale: flakeHash.stale })
    }
    return { expected, workspaceVersion, pluginChecked, flakeHashes: flakeHash }
  })

export class FlakeHashMismatch
  extends Schema.TaggedError<FlakeHashMismatch>()('FlakeHashMismatch', {
    version: Semver,
    stale: Schema.Array(
      Schema.Struct({
        triple: Schema.String,
        reason: Schema.Union([Schema.Literal('mismatch'), Schema.Literal('download-failed')]),
      }),
    ),
  }) {
  override get message(): string {
    return this.stale
      .map((s) =>
        s.reason === 'download-failed'
          ? `check-versions: could not download the v${this.version} release asset for ${s.triple}`
          : `check-versions: flake.nix hash for ${s.triple} does not match the v${this.version} release asset`
      )
      .join('\n')
  }
}

export class FlakeTagMissing extends Schema.TaggedError<FlakeTagMissing>()('FlakeTagMissing', {
  declared: Semver,
  newest: Schema.String,
}) {
  override get message(): string {
    return `check-versions: flake.nix declares v${this.declared} but no such release tag exists and it is not newer than the newest published release (v${this.newest})`
  }
}

export class FlakeRemoteUnreachable
  extends Schema.TaggedError<FlakeRemoteUnreachable>()('FlakeRemoteUnreachable', {}) {
  override get message(): string {
    return 'check-versions: could not list release tags from origin — the flake hash gate cannot verify the declared version'
  }
}

const sriOfDigest = (bytes: Uint8Array) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const digest = yield* crypto.digest('SHA-256', bytes)
    return sriFromSha256(new Uint8Array(digest))
  })

const remoteReleaseTags = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const lsRemote = ChildProcess.make('git', ['ls-remote', '--tags', 'origin'])
  const exit = yield* spawner.exitCode(lsRemote)
  if (exit !== 0) {
    return yield* new FlakeRemoteUnreachable()
  }
  const text = yield* spawner.string(lsRemote)
  return [
    ...new Set(
      [...text.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+)(\^\{\})?$/gm)].map((m) => m[1]),
    ),
  ]
})

const newerThan = (a: string, b: string): boolean => {
  const [am, bm] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < 3; i++) {
    if ((am[i] ?? 0) !== (bm[i] ?? 0)) return (am[i] ?? 0) > (bm[i] ?? 0)
  }
  return false
}

export const checkFlakeHashes = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    if (!(yield* fs.exists(FLAKE_NIX))) {
      return { stale: [], skipped: 'flake.nix absent' }
    }
    const flakeText = yield* fs.readFileString(FLAKE_NIX)
    const declared = yield* extractNixVersion(flakeText, FLAKE_NIX)
    const tag = `v${declared}`
    const releaseTags = yield* remoteReleaseTags
    const tagExists = releaseTags.includes(declared)

    if (!tagExists) {
      const newest = releaseTags.slice().sort((a, b) => newerThan(a, b) ? 1 : -1).at(-1)
      if (newest === undefined || newerThan(declared, newest)) {
        return { stale: [], skipped: `tag ${tag} absent (version bump in flight)` }
      }
      return yield* new FlakeTagMissing({ declared, newest })
    }

    const targetsText = yield* fs.readFileString(TARGETS_PATH)
    const triples = unixTargetTriples(JSON.parse(targetsText) as Target[])
    const results = yield* Effect.acquireRelease(
      fs.makeTempDirectory(),
      (dir) => fs.remove(dir, { recursive: true }).pipe(Effect.orDie),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.forEach(triples, (triple) =>
          Effect.gen(function* () {
            const assetName = `comment-checker-${triple}`
            const code = yield* spawner.exitCode(
              ChildProcess.make('gh', [
                'release',
                'download',
                tag,
                '--pattern',
                assetName,
                '--dir',
                dir,
                '--clobber',
              ]),
            )
            if (code !== 0) {
              return { triple, reason: 'download-failed' as const }
            }
            const bytes = yield* fs.readFile(`${dir}/${assetName}`)
            const sri = yield* sriOfDigest(bytes)
            return flakeText.includes(`"${triple}" = "${sri}"`)
              ? null
              : { triple, reason: 'mismatch' as const }
          }), { concurrency: 4 })
      ),
    )
    return { stale: results.filter((r) => r !== null), skipped: null }
  })
