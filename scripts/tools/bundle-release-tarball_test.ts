import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import { writeReleaseTarball } from '../lib/write-release-tarball.ts'

Deno.test('writeReleaseTarball writes gzip with the target bin member', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const binDir = join(tmp, 'bin')
    const outDir = join(tmp, 'out')
    await Deno.mkdir(binDir)
    await Deno.writeTextFile(join(binDir, 'comment-checker'), 'fixture\n')

    const archive = await writeReleaseTarball(
      outDir,
      'x86_64-unknown-linux-gnu',
      binDir,
      'comment-checker',
    )
    const bytes = await Deno.readFile(archive)
    assertEquals(bytes[0], 0x1f)
    assertEquals(bytes[1], 0x8b)

    const list = await new Deno.Command('tar', {
      args: ['-tzf', archive],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    assertEquals(list.code, 0)
    const members = new TextDecoder().decode(list.stdout).trim().split('\n')
    assertEquals(members, ['comment-checker'])
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})
