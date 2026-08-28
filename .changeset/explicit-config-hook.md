---
"@systemfsoftware/claude-code-comment-checker": patch
---

The `PostToolUse` hook command now invokes `deno run --config <plugin>/hooks/deno.jsonc … <plugin>/hooks/run.ts` explicitly. The config file is what makes Deno treat the hook as a first-class module instead of node-compat material: without it, a hook living under `node_modules` (as an installed plugin does) cannot resolve `@std/*` or `arktype` and never reaches the checker. Passing the config restores the TypeScript source (`run.ts`) with its real imports, replacing the compiled `run.js` shipped in 0.3.1.