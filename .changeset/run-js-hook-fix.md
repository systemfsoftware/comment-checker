---
"@systemfsoftware/claude-code-comment-checker": patch
---

The `PostToolUse` hook is shipped as compiled `run.js` instead of `run.ts`, so it runs on Deno versions that refuse type-stripping inside `node_modules`. Type-checking is preserved through JSDoc annotations and `checkJs` in `hooks/deno.jsonc`.