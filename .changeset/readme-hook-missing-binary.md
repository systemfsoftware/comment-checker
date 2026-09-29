---
'@systemfsoftware/claude-code-comment-checker': patch
---

The documented Claude Code hook command no longer exits without reading the tool payload, so hosts that pipe large payloads no longer fail with a broken pipe. When `comment-checker` is not on `PATH` it now tries `direnv exec` next. When neither finds the checker, the hook reads the whole payload, prints `comment-checker did not run — nothing checked this write.` and exits 1. When the checker runs but exits with a code other than 0 or 2, for example after a crash, the hook reads the rest of the payload, prints `comment-checker failed (exit <code>) — nothing checked this write.` and exits 1. If you copied an earlier snippet, replace its `command` with the one in the README.
