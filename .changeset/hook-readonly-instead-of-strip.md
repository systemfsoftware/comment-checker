---
'@systemfsoftware/claude-code-comment-checker': patch
---

The hook no longer crashes on startup in some environments and silently skips every write, and it no longer needs write access to your files — it flags unnecessary comments read-only and reports them to the model.