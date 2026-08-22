import { assertEquals } from '@std/assert'
import { parse as parseYaml } from '@std/yaml'
import { join } from '@std/path'

const ROOT = join(import.meta.dirname!, '..', '..')
const WORKFLOW = join(ROOT, '.github', 'workflows', 'release.yml')
const SCRIPT = join(ROOT, 'scripts', 'tools', 'run-binary-smoke.ts')

const workflowText = await Deno.readTextFile(WORKFLOW)
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
  assertEquals(smokeStep?.run?.includes('run-binary-smoke.ts'), true)
})

const scriptText = await Deno.readTextFile(SCRIPT)
const rustExitCodes = await Deno.readTextFile(
  join(ROOT, 'crates', 'comment-checker', 'tests', 'exit_codes.rs'),
)

Deno.test('run-binary-smoke.ts pins exit contract 0 (clean) and 2 (flagged)', () => {
  assertEquals(scriptText.includes('cleanRc !== 0'), true, 'missing 0 assertion')
  assertEquals(scriptText.includes('flaggedRc !== 2'), true, 'missing 2 assertion')
})

Deno.test('run-binary-smoke.ts payloads are byte-identical to exit_codes.rs constants', () => {
  const cleanMatch = rustExitCodes.match(/const CLEAN_PAYLOAD:\s*&str\s*=\s*r##"([\s\S]+?)"##;/)
  const flaggedMatch = rustExitCodes.match(/const FLAGGED_PAYLOAD:\s*&str\s*=\s*r#"([\s\S]+?)"#;/)

  assertEquals(cleanMatch !== null, true, 'could not extract CLEAN_PAYLOAD from exit_codes.rs')
  assertEquals(flaggedMatch !== null, true, 'could not extract FLAGGED_PAYLOAD from exit_codes.rs')

  assertEquals(
    scriptText.includes(cleanMatch![1]),
    true,
    'clean payload drifted from exit_codes.rs',
  )
  assertEquals(
    scriptText.includes(flaggedMatch![1]),
    true,
    'flagged payload drifted from exit_codes.rs',
  )
})
