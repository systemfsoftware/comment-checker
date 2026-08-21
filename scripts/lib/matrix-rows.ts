import { parse as parseYaml } from '@std/yaml'

export interface MatrixRow {
  target: string
  suffix: string
  runner: string
}

/**
 * Extract the release matrix include rows (target + suffix + runner) from a
 * workflow document by parsing YAML, not scraping text (issue #8).
 *
 * Formatting cannot break agreement: flow-style lists, quoted keys or values,
 * key reordering, and comments all parse to the same typed rows. Only the
 * job named `release` is consulted, so a decoy matrix-bearing job elsewhere
 * in the workflow cannot satisfy the gate (issue #8 refit). Every include
 * row must carry string target/suffix/runner; a missing or non-conforming
 * row, an empty include, a missing `release` job, or malformed YAML throws —
 * the gate must fail loudly rather than compare against a silent subset.
 */
export function matrixRows(workflowText: string): MatrixRow[] {
  const doc: unknown = parseYaml(workflowText)
  if (typeof doc !== 'object' || doc === null) {
    throw new Error('workflow document is not a mapping')
  }
  const jobs = (doc as Record<string, unknown>).jobs
  if (typeof jobs !== 'object' || jobs === null) {
    throw new Error('workflow has no jobs mapping')
  }
  const releaseJob = (jobs as Record<string, unknown>).release
  if (typeof releaseJob !== 'object' || releaseJob === null) {
    throw new Error('workflow has no release job')
  }
  const strategy = (releaseJob as Record<string, unknown>).strategy
  if (typeof strategy !== 'object' || strategy === null) {
    throw new Error('release job has no strategy')
  }
  const matrix = (strategy as Record<string, unknown>).matrix
  if (typeof matrix !== 'object' || matrix === null) {
    throw new Error('release job has no strategy.matrix')
  }
  const include = (matrix as Record<string, unknown>).include
  if (!Array.isArray(include)) {
    throw new Error('release job has no strategy.matrix.include')
  }
  if (include.length === 0) {
    throw new Error('release matrix include is empty')
  }
  const rows: MatrixRow[] = []
  for (const row of include) {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`malformed include row (not a mapping): ${JSON.stringify(row)}`)
    }
    const record = row as Record<string, unknown>
    const target = record.target
    const suffix = record.suffix
    const runner = record.runner
    if (
      typeof target !== 'string' ||
      typeof suffix !== 'string' ||
      typeof runner !== 'string'
    ) {
      throw new Error(
        `malformed include row: target/suffix/runner must be strings, got ${
          JSON.stringify(record)
        }`,
      )
    }
    rows.push({ target, suffix, runner })
  }
  return rows
}
