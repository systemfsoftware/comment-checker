import { parse as parseYaml } from '@std/yaml'

export interface MatrixRow {
  target: string
  suffix: string
}

/**
 * Extract the release matrix include rows (target + suffix) from a workflow
 * document by parsing YAML, not scraping text (issue #8).
 *
 * Formatting cannot break agreement: flow-style lists, quoted keys or values,
 * key reordering, and comments all parse to the same typed rows. Returns an
 * empty list when no job carries a `strategy.matrix.include` list — callers
 * must treat that as a failure, since an empty matrix cannot agree with the
 * targets table.
 */
export function matrixRows(workflowText: string): MatrixRow[] {
  const doc: unknown = parseYaml(workflowText)
  if (typeof doc !== 'object' || doc === null) return []
  const jobs = (doc as Record<string, unknown>).jobs
  if (typeof jobs !== 'object' || jobs === null) return []
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (typeof job !== 'object' || job === null) continue
    const strategy = (job as Record<string, unknown>).strategy
    if (typeof strategy !== 'object' || strategy === null) continue
    const matrix = (strategy as Record<string, unknown>).matrix
    if (typeof matrix !== 'object' || matrix === null) continue
    const include = (matrix as Record<string, unknown>).include
    if (!Array.isArray(include)) continue
    const rows: MatrixRow[] = []
    for (const row of include) {
      if (typeof row !== 'object' || row === null) continue
      const record = row as Record<string, unknown>
      if (typeof record.target === 'string' && typeof record.suffix === 'string') {
        rows.push({ target: record.target, suffix: record.suffix })
      }
    }
    if (rows.length > 0) return rows
  }
  return []
}
