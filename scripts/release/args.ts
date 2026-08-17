// Shared, dependency-free CLI flag parser for the release scripts. Each script
// used to duplicate this loop; one copy keeps missing-value / unknown-argument
// semantics identical across all three.
export interface FlagSpec {
  /** flags that consume a value (--flag <value>) */
  string: string[]
  /** flags that are pure booleans (presence = true) */
  boolean?: string[]
  /** map canonical flag key -> returned key, e.g. binary-sha256 -> binarySha256 */
  rename?: Record<string, string>
}

export type ParsedArgs = Record<string, string | boolean | undefined>

// Parses a CLI argv. Unknown arguments and missing values exit(1) with the
// same messages the previous per-script parsers produced; tests never pin
// parser error text.
export function parseFlags(argv: string[], spec: FlagSpec): ParsedArgs {
  const booleanFlags = spec.boolean ?? []
  const keyOf = (flag: string): string => spec.rename?.[flag] ?? flag
  const out: ParsedArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      console.error(`unknown argument: ${arg}`)
      Deno.exit(1)
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    const name = eq === -1 ? body : body.slice(0, eq)
    if (booleanFlags.includes(name) && eq === -1) {
      out[keyOf(name)] = true
      continue
    }
    if (spec.string.includes(name)) {
      if (eq !== -1) {
        out[keyOf(name)] = body.slice(eq + 1)
        continue
      }
      const value = argv[i + 1]
      // A consumed value that itself looks like a flag is a missing value for
      // the current flag — `--version --dry-run` must not silently take
      // `--dry-run` as the version. The `--flag=value` form still admits
      // values starting with `-`.
      if (value === undefined || value.startsWith('--')) {
        console.error(`missing value for --${name}`)
        Deno.exit(1)
      }
      out[keyOf(name)] = value
      i++
      continue
    }
    console.error(`unknown argument: ${arg}`)
    Deno.exit(1)
  }
  return out
}
