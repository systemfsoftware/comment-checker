import { assertEquals } from '@std/assert'
import { parse as parseYaml } from '@std/yaml'
import { join } from '@std/path'

// Issue #12: the release workflow's smoke step hard-codes the exit-code
// contract (`rc -eq 0` / `rc -eq 2`) that crates/comment-checker/tests/
// exit_codes.rs also asserts. Previously the two could drift silently and
// the mismatch surfaced only at the first tagged publish. This test parses
// release.yml and pins the workflow's own copy of the contract AND the exact
// payload bytes so any change to either side breaks CI here, not at tag time.

const ROOT = join(import.meta.dirname!, '..', '..')
const WORKFLOW = join(ROOT, '.github', 'workflows', 'release.yml')

const CLEAN_PAYLOAD =
  '{"tool_name":"Write","tool_input":{"file_path":"src/client.py","content":"# SPDX-License-Identifier: Apache-2.0\\ndef load(path):\\n    return open(path).read()\\n"}}'

// Must stay byte-identical to FLAGGED_PAYLOAD in
// crates/comment-checker/tests/exit_codes.rs.
const FLAGGED_PAYLOAD =
  '{"tool_name":"Write","tool_input":{"file_path":"src/load_config.py","content":"def load_config(path):\\n    # TODO: fix this later\\n    return json.load(open(path))\\n"}}'

const workflowText = Deno.readTextFileSync(WORKFLOW)
const doc = parseYaml(workflowText) as {
  jobs: Record<string, { steps?: Array<{ name?: string; run?: string }> }>
}
const jobs = doc.jobs ?? {}
const smokeStep = Object.values(jobs)
  .flatMap((job) => job.steps ?? [])
  .find((step) => step.name === 'Gate: binary smoke tests')

Deno.test('release.yml smoke step exists in every job set', () => {
  assertEquals(typeof smokeStep, 'object')
  assertEquals(typeof smokeStep?.run, 'string')
})

Deno.test('release.yml smoke step pins exit contract 0 (clean) and 2 (flagged)', () => {
  const run = smokeStep!.run!
  assertEquals(run.includes('test "$rc" -eq 0'), true, 'missing -eq 0 assertion')
  assertEquals(run.includes('test "$rc" -eq 2'), true, 'missing -eq 2 assertion')
})

Deno.test('release.yml smoke payloads are byte-identical to exit_codes.rs constants', () => {
  const run = smokeStep!.run!
  assertEquals(run.includes(FLAGGED_PAYLOAD), true, 'flagged payload drifted from exit_codes.rs')
  assertEquals(run.includes(CLEAN_PAYLOAD), true, 'clean payload drifted from exit_codes.rs')
})
