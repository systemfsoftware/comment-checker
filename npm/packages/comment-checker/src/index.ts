#!/usr/bin/env node
import { createRequire } from "node:module"
import { Data, Effect, Option, Path, Runtime } from "effect"
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
}> { }

class ChildProcessExited extends Data.TaggedError("ChildProcessExited")<{
  readonly exitCode: ChildProcessSpawner.ExitCode
}> {
  override get [Runtime.errorExitCode](): ChildProcessSpawner.ExitCode {
    return this.exitCode
  }
  override readonly [Runtime.errorReported] = false
}

const getBinaryPath = Effect.gen(function* () {
  const path = yield* Path.Path

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

  return path.join(path.dirname(pkgJsonPath), binaryFileName(platform))
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
      const code = yield* spawner.exitCode(child)

      if (code !== ChildProcessSpawner.ExitCode(0)) {
        return yield* new ChildProcessExited({ exitCode: code })
      }
    })
)

const { version } = require("../package.json") as { version: string }

NodeRuntime.runMain(
  Command.run(command, { version }).pipe(Effect.provide(NodeServices.layer))
)
