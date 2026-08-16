# CONCEPTS.md

Domain vocabulary for comment-checker: words with codebase-specific meaning
that solutions docs and instructions cite without redefinition.

## Classifier verdicts

### Restatement (RestatesCode)
A comment that says, in prose, what its adjacent code already says — the
filled-in words or the verb-to-operator mapping (`"increment"` ↔ `+=`) are
the same fact twice. Distinct from a justification, which adds a reason the
code cannot show.

### Flow narration (NarratesControlFlow)
A comment that names the control construct the adjacent code already
displays (`"loop over each"` beside a `for`) — the kind that reads like
spoken code and adds nothing.

## Evidence and context

### Cited evidence (RestateEvidence)
The tokens or verb→operator matches a restatement verdict was built on,
published with the flag so the reason is checkable against the code. A
verdict that cannot cite verified evidence is not emitted.

### Unreliable context
Structural context (the adjacent-code window) that cannot vouch for the
comment because the input was a fragment: Edit/MultiEdit boundaries truncate
what the hook can see. Verdicts that depend on context never convict on
unreliable context — they fail open (spare). Explicit text-only rules
(unlike restatement) still apply on fragments, because they need no context.

### Reliable adjacency
The production parse's adjacent-code snippet when the hook had the whole
file and the code window is trustworthy; the only input context-aware
verdicts may cite.

## Quality gates

### Per-kind floor
A per-kind/precision-recall gate on the corpus that trips when a kind's
classifier weakens — including a single-case kind that goes wrong — so a
weakness in one kind cannot hide inside an aggregate F1 score.

## Flagged ambiguities

- "context" had been used for both the language (scope/position) and the
  evidence (adjacent code) — these are distinct; adjacent syntax is the
  only context that carries the mention.