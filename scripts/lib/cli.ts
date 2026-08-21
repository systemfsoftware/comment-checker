import { parseArgs, type ParseOptions } from '@std/cli/parse-args'

const die = (message: string): never => {
  console.error(message)
  Deno.exit(1)
}

// @std/cli parses a string flag given without a value as "".
export function parseCliArgs(
  options: ParseOptions<string | undefined, string | undefined>,
): ReturnType<typeof parseArgs> {
  const flags = parseArgs(Deno.args, {
    ...options,
    unknown: (arg) => die(`unknown argument: ${arg}`),
  })
  if (flags._.length > 0) {
    die(`unknown argument: ${flags._[0]}`)
  }
  for (const name of stringFlags(options.string)) {
    if (flags[name] === '') {
      die(`missing value for --${name}`)
    }
  }
  return flags
}

function stringFlags(names: string | readonly string[] | undefined): string[] {
  if (names === undefined) return []
  return typeof names === 'string' ? [names] : [...names]
}
