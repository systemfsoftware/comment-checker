#!/usr/bin/env node
import { createRequire } from "node:module"
import { Data, Effect, FileSystem, Option, Path } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Command, Flag } from "effect/unstable/cli"
import { binaryFileName, optionalDepName } from "./platform.js"

const require = createRequire(import.meta.url)

class BinaryNotFound extends Data.TaggedError("BinaryNotFound")<{
  readonly platform: string
  readonly arch: string
  readonly package: string
  readonly message: string
}> {}

const getBinaryPath = Effect.gen(function* () {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem

  const platform = process.platform
  const arch = process.arch
  const pkg = optionalDepName(platform, arch)

  const pkgJsonPath = yield* Effect.try({
    try: () => require.resolve(`${pkg}/package.json`),
    catch: () =>
      new BinaryNotFound({
        platform,
        arch,
        package: pkg,
        message: `the npm platform package for ${platform}/${arch} (${pkg}) is not installed`,
      }),
  })

  const binaryPath = path.join(path.dirname(pkgJsonPath), binaryFileName(platform))

  if (!(yield* fs.exists(binaryPath))) {
    return yield* new BinaryNotFound({
      platform,
      arch,
      package: pkg,
      message: `the npm platform package for ${platform}/${arch} (${pkg}) is not installed`,
    })
  }

  return binaryPath
})

const command = Command.make(
  "comment-checker",
  {
    prompt: Flag.optional(Flag.string("prompt")),
  },
  (config) =>
    Effect.gen(function* () {
      const binaryPath = yield* getBinaryPath
      const args = Option.match(config.prompt, {
        onNone: () => [],
        onSome: (prompt) => ["--prompt", prompt],
      })

      const child = ChildProcess.make(binaryPath, args, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })

      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const exitCode = yield* spawner.exitCode(child)

      process.exitCode = exitCode
    })
)

const { version } = require("../package.json") as { version: string }

NodeRuntime.runMain(
  Command.run(command, { version }).pipe(Effect.provide(NodeServices.layer))
)
