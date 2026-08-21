import type { LauncherManifest, Target } from './shared.ts'

export interface PlatformPackageManifest {
  name: string
  version: string
  description: string
  license: string
  repository: { type: string; url: string }
  os: [string]
  cpu: [string]
  files: [string]
  peerDependencies: Record<string, string>
  publishConfig: { access: 'public'; provenance: true }
  libc?: [string]
  binarySha256?: string
}

export function buildPlatformManifest(
  launcher: LauncherManifest,
  entry: Target,
  version: string,
  binarySha256?: string,
): PlatformPackageManifest {
  const pkg: PlatformPackageManifest = {
    name: `${launcher.name}-${entry.suffix}`,
    version,
    description: `${launcher.name} ${entry.suffix} platform package`,
    license: 'Apache-2.0',
    repository: launcher.repository,
    os: [entry.os],
    cpu: [entry.cpu],
    files: [entry.bin],
    // Issue #4: a direct install of the platform package declares the
    // launcher it belongs to. npm auto-installs the peer, so a raw platform
    // install resolves to a launcher-consistent set instead of surfacing a
    // version-skewed BinaryNotFound at runtime.
    peerDependencies: { [launcher.name]: version },
    // No bin field — a platform package's bin would collide with the launcher's
    // own comment-checker shim.
    publishConfig: { access: 'public', provenance: true },
  }
  if (entry.libc !== undefined) {
    pkg.libc = [entry.libc]
  }
  if (binarySha256 !== undefined) {
    pkg.binarySha256 = binarySha256
  }
  return pkg
}
