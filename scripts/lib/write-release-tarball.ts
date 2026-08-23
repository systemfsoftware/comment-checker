import { join, resolve } from '@std/path'
import { gnuTarCreateArgs } from './archive-path-for-gnu-tar.ts'

export async function writeReleaseTarball(
  outDir: string,
  targetName: string,
  binDir: string,
  bin: string,
): Promise<string> {
  await Deno.mkdir(outDir, { recursive: true })
  // tar runs with cwd=binDir, so the archive path must be absolute: a relative
  // one would resolve against binDir instead of the invocation directory.
  const tarPath = join(resolve(outDir), `comment-checker-${targetName}.tar.gz`)
  const tarCmd = new Deno.Command('tar', {
    args: gnuTarCreateArgs(tarPath, bin),
    cwd: binDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const res = await tarCmd.output()
  if (!res.success) {
    throw new Error(`tar failed with exit code ${res.code}`)
  }
  return tarPath
}
