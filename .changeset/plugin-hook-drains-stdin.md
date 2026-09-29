---
'@systemfsoftware/claude-code-comment-checker': patch
---

The Claude Code plugin hook no longer exits without reading the tool payload, so hosts that pipe large payloads no longer fail with a broken pipe. It passes through only the checker's own exit codes 0 and 2. When the checker cannot be found, or `deno` is missing or fails to start, the hook reads the whole payload, prints `comment-checker did not run — nothing checked this write.` and exits 1. When the checker runs but exits with any other code, the hook prints `comment-checker failed (exit <code>) — nothing checked this write.` and exits 1, where it used to pass that code through.
