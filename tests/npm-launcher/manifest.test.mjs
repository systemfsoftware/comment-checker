import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

const manifest = JSON.parse(
  readFileSync(new URL("../../npm/packages/comment-checker/package.json", import.meta.url), "utf8")
)

// The five platform packages the launcher resolves by identity
// (process.platform/process.arch -> <platform>-<arch>). Keep in sync with
// scripts/release/targets.json (checked by tests/release).
const PLATFORMS = [
  ["linux", "x64"],
  ["linux", "arm64"],
  ["darwin", "x64"],
  ["darwin", "arm64"],
  ["win32", "x64"],
]

const expectedOptionalDeps = Object.fromEntries(
  PLATFORMS.map(([platform, arch]) => [
    `@systemfsoftware/claude-code-comment-checker-${platform}-${arch}`,
    "0.1.0",
  ])
)

test("launcher manifest declares no install-time script", () => {
  assert.equal(manifest.postinstall, undefined)
  assert.equal(manifest.prepare, undefined)
  assert.equal(manifest.install, undefined)
})

test("launcher manifest ships only the built launcher", () => {
  assert.deepEqual(manifest.files, ["dist"])
  assert.deepEqual(manifest.bin, { "comment-checker": "./dist/index.mjs" })
  assert.equal(manifest.private, undefined)
})

test("optionalDependencies pins exactly the five platform packages", () => {
  assert.deepEqual(manifest.optionalDependencies, expectedOptionalDeps)
})

test("publishConfig requests public access and provenance", () => {
  assert.equal(manifest.publishConfig.access, "public")
  assert.equal(manifest.publishConfig.provenance, true)
})

test("engines floor is Node >= 18", () => {
  assert.equal(manifest.engines.node, ">=18")
})

test("Effect deps pinned to the vendored rc revision", () => {
  assert.equal(manifest.dependencies.effect, "4.0.0-rc.108")
  assert.equal(manifest.dependencies["@effect/platform-node"], "4.0.0-rc.108")
})