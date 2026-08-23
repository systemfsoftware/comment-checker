import { assertEquals } from '@std/assert'
import { archivePathForGnuTar, gnuTarCreateArgs } from './archive-path-for-gnu-tar.ts'

const OBSERVED_WIN =
  'D:\\a\\comment-checker\\comment-checker\\dist\\release-tarball-win32-x64\\comment-checker-x86_64-pc-windows-msvc.tar.gz'

Deno.test('rewrites the observed GHA Windows archive path to an MSYS path', () => {
  assertEquals(
    archivePathForGnuTar(OBSERVED_WIN),
    '/d/a/comment-checker/comment-checker/dist/release-tarball-win32-x64/comment-checker-x86_64-pc-windows-msvc.tar.gz',
  )
})

Deno.test('rewrites forward-slash drive paths', () => {
  assertEquals(archivePathForGnuTar('C:/Users/x/out/a.tar.gz'), '/c/Users/x/out/a.tar.gz')
})

Deno.test('leaves POSIX absolute paths unchanged', () => {
  assertEquals(archivePathForGnuTar('/tmp/out/a.tar.gz'), '/tmp/out/a.tar.gz')
})

Deno.test('create argv uses --force-local only for drive-letter archive paths', () => {
  assertEquals(gnuTarCreateArgs(OBSERVED_WIN, 'comment-checker.exe'), [
    '--force-local',
    '-czf',
    '/d/a/comment-checker/comment-checker/dist/release-tarball-win32-x64/comment-checker-x86_64-pc-windows-msvc.tar.gz',
    'comment-checker.exe',
  ])
  assertEquals(gnuTarCreateArgs('/tmp/out/a.tar.gz', 'comment-checker'), [
    '-czf',
    '/tmp/out/a.tar.gz',
    'comment-checker',
  ])
})
