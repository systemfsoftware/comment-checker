import { LAUNCHER_MANIFEST_PATH, type LauncherManifest, type Target, TARGETS_PATH } from './shared.ts'

export interface PackageTarget {
  name: string
  kind: 'launcher' | 'platform'
  suffix?: string
  target?: Target
}

export interface RegistrySnapshot {
  name: string
  status: number
  unpublished: boolean
  latest?: string
  attested?: boolean
}

export async function readDistributionSet(): Promise<{
  launcher: LauncherManifest
  targets: Target[]
  packages: PackageTarget[]
}> {
  const launcher: LauncherManifest = JSON.parse(await Deno.readTextFile(LAUNCHER_MANIFEST_PATH))
  const targets: Target[] = JSON.parse(await Deno.readTextFile(TARGETS_PATH))
  const packages: PackageTarget[] = [
    { name: launcher.name, kind: 'launcher' },
    ...targets.map((target) => ({
      name: `${launcher.name}-${target.suffix}`,
      kind: 'platform' as const,
      suffix: target.suffix,
      target,
    })),
  ]
  return { launcher, targets, packages }
}

export function remoteSlugFromRepo(repoRoot: string): string {
  const cmd = new Deno.Command('git', {
    args: ['-C', repoRoot, 'remote', 'get-url', 'origin'],
    stdout: 'piped',
    stderr: 'piped',
  })
  const res = cmd.outputSync()
  if (!res.success) {
    const err = new TextDecoder().decode(res.stderr).trim()
    throw new Error(`cannot read origin remote: ${err}`)
  }
  const text = new TextDecoder().decode(res.stdout).trim()
  for (
    const re of [
      /^[^:]+:([^/]+)\/([^/]+?)(\.git)?$/m,
      /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(\.git)?$/m,
    ]
  ) {
    const m = text.match(re)
    if (m) return `${m[1]}/${m[2]}`
  }
  throw new Error(`cannot parse origin remote: ${text}`)
}

export async function queryRegistry(name: string, registry: string): Promise<RegistrySnapshot> {
  const url = `${registry}/${encodeURIComponent(name)}`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) {
      return { name, status: 404, unpublished: true }
    }
    if (!res.ok) {
      return { name, status: res.status, unpublished: false }
    }
    const body = await res.json() as {
      'dist-tags'?: Record<string, unknown>
      versions?: Record<string, { dist?: { attestations?: unknown } }>
      error?: string
    }
    if (body.error === 'Not found') {
      return { name, status: 404, unpublished: true }
    }
    const distTags = body['dist-tags']
    const latest = typeof distTags?.latest === 'string'
      ? distTags.latest
      : (typeof distTags?.next === 'string' ? distTags.next : undefined)
    const attested = latest !== undefined && body.versions?.[latest]?.dist?.attestations != null
    return { name, status: res.status, unpublished: false, latest, attested }
  } catch {
    return { name, status: 0, unpublished: false }
  }
}
