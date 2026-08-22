#!/usr/bin/env -S deno run --allow-run --allow-read

const stages: string[] = []
for await (const entry of Deno.readDir('stages')) {
  if (entry.isDirectory) {
    stages.push(`stages/${entry.name}`)
  }
}

if (stages.length !== 5) {
  console.error(`expected 5 staged platform packages, found ${stages.length}`)
  Deno.exit(1)
}

for (const stage of stages) {
  const cmd = new Deno.Command('pnpm', {
    args: ['publish', '--provenance', '--access', 'public', '--no-git-checks'],
    cwd: stage,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const res = await cmd.output()
  if (!res.success) {
    console.error(`pnpm publish failed for ${stage}`)
    Deno.exit(1)
  }
}

console.log('all platform packages published')
