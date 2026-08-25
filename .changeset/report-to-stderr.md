---
'@systemfsoftware/claude-code-comment-checker': minor
---

Flagged-comment reports now go to stderr instead of stdout, so the agent that made the edit actually receives them. A blocked verdict previously exited 2 with its report on stdout, which the hook contract discards, so the block arrived carrying no explanation of what was flagged.

If you capture reports yourself, read stderr. Exit codes are unchanged: 0 when nothing is flagged, 2 when something is.
