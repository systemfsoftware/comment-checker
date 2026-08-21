import { join } from '@std/path'

const ROOT = join(import.meta.dirname!, '..', '..')

export const TARGETS_PATH = join(ROOT, 'scripts', 'release', 'targets.json')
export const LAUNCHER_MANIFEST_PATH = join(
  ROOT,
  'npm',
  'packages',
  'comment-checker',
  'package.json',
)
export const RELEASE_WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'release.yml')

export interface Target {
  target: string
  suffix: string
  os: string
  cpu: string
  libc?: string
  bin: string
}

export interface LauncherManifest {
  name: string
  version: string
  repository: { type: string; url: string }
  optionalDependencies?: Record<string, string>
}
