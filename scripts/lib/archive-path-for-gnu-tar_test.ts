import { assertEquals, assertNotMatch } from '@std/assert'
import { archivePathForGnuTar, gnuTarCreateArgs } from './archive-path-for-gnu-tar.ts'

const OBSERVED_WIN =
  'D:\\a\\comment-checker\\comment-checker\\dist\\release-tarball-win32-x64\\comment-checker-x86_64-pc-windows-msvc.tar.gz'

Deno.test('rewrites the observed GHA Windows archive path to an MSYS path', () => {
  const out = archivePathForGnuTar(OBSERVED_WIN)
  assertEquals(
    out,
    '/d/a/comment-checker/comment-checker/dist/release-tarball-win32-x64/comment-checker-x86_64-pc-windows-msvc.tar.gz',
  )
  assertNotMatch(out, /^[A-Za-z]:/)
})

Deno.test('rewrites forward-slash drive paths', () => {
  assertEquals(archivePathForGnuTar('C:/Users/x/out/a.tar.gz'), '/c/Users/x/out/a.tar.gz')
})

Deno.test('leaves POSIX absolute paths unchanged', () => {
  assertEquals(archivePathForGnuTar('/tmp/out/a.tar.gz'), '/tmp/out/a.tar.gz')
})

Deno.test('create argv includes --force-local and never a drive-letter archive path', () => {
  const args = gnuTarCreateArgs(OBSERVED_WIN, 'comment-checker.exe')
  assertEquals(args[0], '--force-local')
  assertEquals(args[1], '-czf')
  assertNotMatch(args[2], /^[A-Za-z]:/)
  assertEquals(args[3], 'comment-checker.exe')
})
