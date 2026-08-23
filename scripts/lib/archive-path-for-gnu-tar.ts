const DRIVE_ABS = /^([A-Za-z]):[\\/](.*)$/

export function archivePathForGnuTar(absPath: string): string {
  const drive = absPath.match(DRIVE_ABS)
  if (drive) {
    return `/${drive[1].toLowerCase()}/${drive[2].replaceAll('\\', '/')}`
  }
  return absPath.replaceAll('\\', '/')
}

export function gnuTarCreateArgs(archivePath: string, member: string): string[] {
  const dest = archivePathForGnuTar(archivePath)
  if (DRIVE_ABS.test(archivePath)) {
    return ['--force-local', '-czf', dest, member]
  }
  return ['-czf', dest, member]
}
