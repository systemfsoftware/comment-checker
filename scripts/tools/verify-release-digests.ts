#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { join } from '@std/path'
import { type Target, TARGETS_PATH } from '../lib/shared.ts'

const version = Deno.env.get('VERSION')
const refName = Deno.env.get('GITHUB_REF_NAME')
const runnerTemp = Deno.env.get('RUNNER_TEMP') ?? '/tmp'

if (!version || !refName) {
  console.error('VERSION and GITHUB_REF_NAME required')
  Deno.exit(1)
}

const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))

async function computeSha256(filePath: string): Promise<string> {
  const bytes = await Deno.readFile(filePath)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

for (const target of targets) {
  const sidecarPath = `sidecars/binary-${target.suffix}.sha256`
  const recordedSha = (await Deno.readTextFile(sidecarPath)).trim()
  if (!recordedSha) {
    console.error(`missing recorded sha for ${target.suffix}`)
    Deno.exit(1)
  }

  const tarballName = `comment-checker-${target.target}.tar.gz`
  const ghDl = await new Deno.Command('gh', {
    args: [
      'release',
      'download',
      refName,
      '--pattern',
      tarballName,
      '--dir',
      runnerTemp,
      '--clobber',
    ],
  }).output()
  if (!ghDl.success) {
    console.error(`gh release download failed for ${tarballName}`)
    Deno.exit(1)
  }

  const releaseUnpack = join(runnerTemp, `release-unpack-${target.suffix}`)
  await Deno.mkdir(releaseUnpack, { recursive: true })
  const tarRel = await new Deno.Command('tar', {
    args: ['-xzf', join(runnerTemp, tarballName), '-C', releaseUnpack],
  }).output()
  if (!tarRel.success) {
    console.error(`failed to unpack release tarball for ${target.suffix}`)
    Deno.exit(1)
  }

  const releaseBinSha = await computeSha256(join(releaseUnpack, target.bin))
  if (releaseBinSha !== recordedSha) {
    console.error(`release asset digest mismatch for ${target.suffix}`)
    Deno.exit(1)
  }

  const pkgName = `@systemfsoftware/claude-code-comment-checker-${target.suffix}`
  const packOut = await new Deno.Command('npm', {
    args: ['pack', `${pkgName}@${version}`, '--pack-destination', runnerTemp],
    stdout: 'piped',
  }).output()
  if (!packOut.success) {
    console.error(`npm pack failed for ${pkgName}@${version}`)
    Deno.exit(1)
  }
  const packFileName = new TextDecoder().decode(packOut.stdout).trim().split('\n').pop()!

  const npmUnpack = join(runnerTemp, `npm-unpack-${target.suffix}`)
  await Deno.mkdir(npmUnpack, { recursive: true })
  const tarNpm = await new Deno.Command('tar', {
    args: ['-xzf', join(runnerTemp, packFileName), '-C', npmUnpack],
  }).output()
  if (!tarNpm.success) {
    console.error(`failed to unpack npm tarball for ${target.suffix}`)
    Deno.exit(1)
  }

  const npmBinSha = await computeSha256(join(npmUnpack, 'package', target.bin))
  if (npmBinSha !== recordedSha) {
    console.error(`npm tarball digest mismatch for ${target.suffix}`)
    Deno.exit(1)
  }

  console.log(`${target.suffix} digests verified`)
}
