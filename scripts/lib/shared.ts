import { join } from '@std/path'

const ROOT = join(import.meta.dirname!, '..', '..')

export const TARGETS_PATH = join(ROOT, 'scripts', 'lib', 'targets.json')
export const LAUNCHER_MANIFEST_PATH = join(
  ROOT,
  'npm',
  'packages',
  'comment-checker',
  'package.json',
)
export const RELEASE_WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'release.yml')
export const CI_WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'ci.yml')
export const PLATFORM_WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'platform.yml')

export interface Target {
  target: string
  suffix: string
  os: string
  cpu: string
  libc?: string
  runner: string
  bin: string
}

export interface LauncherManifest {
  name: string
  version: string
  repository: { type: string; url: string }
  optionalDependencies?: Record<string, string>
}
/** SRI encoding of a SHA-256 digest (Nix `fetchurl` hash format). */
export const sriFromSha256 = (digest: Uint8Array): string =>
  `sha256-${btoa(String.fromCharCode(...digest))}`

/** Flake hash-block keys: every target except the win32 row in targets.json. */
export const unixTargetTriples = (targets: Target[]): string[] =>
  targets.filter((t) => t.os !== 'win32').map((t) => t.target)
