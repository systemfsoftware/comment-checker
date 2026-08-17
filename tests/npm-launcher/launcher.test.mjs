// Black-box suite for the npm launcher (dist/index.mjs). Requires a prior
// `pnpm -r build`: the launcher entry and the extracted platform module are
// imported from the built dist/ output below.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import assert from "node:assert/strict"

import { binaryFileName, optionalDepName } from "../../npm/packages/comment-checker/dist/platform.mjs"

const launcherPath = fileURLToPath(
  new URL("../../npm/packages/comment-checker/dist/index.mjs", import.meta.url)
)

const hostDep = `@systemfsoftware/claude-code-comment-checker-${process.platform}-${process.arch}`
const skipNoPosixShim =
  process.platform === "win32"
    ? "cannot fabricate a .exe shim in a test fixture; the released binary covers win32"
    : false

// Build a fake install: <root>/node_modules/@systemfsoftware/<host-dep>/ with a
// package.json and an executable shim named after the host binary. NODE_PATH
// entries are joined directly with the requested id, so it must point at the
// fixture's node_modules dir for createRequire to resolve the package.
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "comment-checker-launcher-"))
  const pkgDir = join(root, "node_modules", hostDep)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, "package.json"), `${JSON.stringify({ name: hostDep, version: "0.0.0" })}\n`)
  if (process.platform !== "win32") {
    const shim = ["#!/bin/sh", "printf '%s\\n' \"$*\"", 'exit "${SHIM_EXIT:-0}"'].join("\n")
    writeFileSync(join(pkgDir, binaryFileName(process.platform)), `${shim}\n`, { mode: 0o755 })
  }
  return { root, npmPath: join(root, "node_modules") }
}

const runLauncher = (npmPath, args = [], extraEnv = {}) =>
  spawnSync(process.execPath, [launcherPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: npmPath, ...extraEnv },
    timeout: 30_000,
  })

test(
  "launcher spawns the host platform shim and passes args through",
  { skip: skipNoPosixShim },
  () => {
    const { root, npmPath } = makeFixture()
    try {
      const res = runLauncher(npmPath, ["--prompt", "hello"])
      assert.equal(res.status, 0, res.stdout)
      assert.match(res.stdout, /hello/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test("launcher propagates the child exit code", { skip: skipNoPosixShim }, () => {
  const { root, npmPath } = makeFixture()
  try {
    const res = runLauncher(npmPath, ["--prompt", "hello"], { SHIM_EXIT: "42" })
    assert.equal(res.status, 42, res.stdout)
    assert.match(res.stdout, /hello/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("missing platform package fails with BinaryNotFound naming the package", () => {
  const root = mkdtempSync(join(tmpdir(), "comment-checker-missing-"))
  const npmPath = join(root, "node_modules")
  mkdirSync(npmPath, { recursive: true })
  try {
    const res = runLauncher(npmPath, ["--prompt", "hello"])
    assert.notEqual(res.status, 0)
    // Effect rc.108's default console logger writes to stdout, not stderr, so
    // the failure report is matched against the combined output.
    const output = `${res.stdout}${res.stderr}`
    assert.match(output, /BinaryNotFound/)
    assert.ok(output.includes(hostDep), `output should name ${hostDep}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("platform helpers follow the release naming convention", () => {
  assert.equal(optionalDepName("win32", "x64"), "@systemfsoftware/claude-code-comment-checker-win32-x64")
  assert.equal(binaryFileName("win32"), "comment-checker.exe")
  assert.equal(binaryFileName("linux"), "comment-checker")
})

const targets = JSON.parse(
  readFileSync(new URL("../../scripts/release/targets.json", import.meta.url), "utf8")
)

for (const target of targets) {
  test(`target ${target.target} maps to optional dep ${target.suffix}`, () => {
    assert.equal(
      optionalDepName(target.os, target.cpu),
      `@systemfsoftware/claude-code-comment-checker-${target.suffix}`
    )
    assert.equal(binaryFileName(target.os), target.bin)
  })
}