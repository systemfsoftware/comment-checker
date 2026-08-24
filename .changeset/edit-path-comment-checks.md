---
'@systemfsoftware/claude-code-comment-checker': patch
---

Comments introduced by an `Edit` or `MultiEdit` are now judged the same way as comments written by a `Write`. Previously an edit reported only what a comment's own wording revealed — a bare `TODO`, commented-out code, a note about the change just made — so a comment that restated the code beside it or narrated the loop below it was reported on a whole-file write but passed on an edit. Nothing to configure; expect edits to existing files to be flagged more often.
