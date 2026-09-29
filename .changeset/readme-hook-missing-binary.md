---
'@systemfsoftware/claude-code-comment-checker': patch
---

The documented Claude Code hook command no longer exits 127 without reading the tool payload when `comment-checker` is not on `PATH`: it now tries `direnv exec` next, and when neither finds the checker it reads the whole payload, prints `comment-checker did not run — nothing checked this write.` and exits 1, so hosts that pipe large payloads no longer fail with a broken pipe. If you copied the earlier snippet, replace its `command` with the one in the README.
