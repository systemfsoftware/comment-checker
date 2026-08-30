---
'@systemfsoftware/claude-code-comment-checker': patch
---

The hook no longer crashes on startup in some environments and skips every write; a comment-strip that cannot update the file (for example on a read-only mount) now fails loudly with a report instead of a silent warning. If you see `could not write ... Read-only file system`, give the hook's process write access to the files it checks — a writable checkout or a read-write mount.