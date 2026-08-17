import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

const manifest = JSON.parse(
  readFileSync(new URL("../../npm/packages/comment-checker/package.json", import.meta.url), "utf8")
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

test("committed manifest carries no optionalDependencies (pre-publish)", () => {
  // pnpm cannot record unresolvable optional deps in a lockfile, so the
  // committed manifest must not name the unpublished platform packages;
  // sync-root-version.ts injects the targets.json pins at publish time.
  assert.equal(manifest.optionalDependencies, undefined)
  assert.equal(manifest.version, "0.1.0")
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