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

## npm distribution

### Launcher
The root npm package (`@systemfsoftware/claude-code-comment-checker`) whose
`bin` is the `comment-checker` shim. It resolves the host platform package by
identity at runtime and spawns the binary — the only package that declares a
bin.

### Platform package
One per os-cpu pair (`-linux-x64`, `-darwin-arm64`, …), generated from
`scripts/lib/targets.json`: ships only the compiled binary and its
manifest (`os`/`cpu`/`libc` fields, no `bin`). The launcher's
`optionalDependencies` pins all five to the release version.

The committed launcher manifest never lists these packages as
`optionalDependencies` — pnpm cannot lock unpublished platform packages
(pnpm#3960), so the pins are injected from the targets table at publish
time; absence in-tree is expected, not a defect.

### Release lane
A matrix row in the release workflow: one platform/arch build, gate, smoke,
and publish run on its native runner. Platforms publish before the launcher,
and the release cannot proceed if any lane fails.

## Mutation gate

### Verdict cache
The turbo task cache that stores the mutation gate's result keyed on the
gate's input set; unchanged inputs replay the stored verdict instead of
re-running the mutant loop.

Two hash surfaces govern it. The task hash is the gate's own key: every
file that can change the verdict must be an explicit task input — automatic
coverage extends only to the script body and declared env values. The
transport key (the CI cache step's key) must be a superset of the task hash
surface, because an exact-key restore suppresses the post-run save: a
narrower transport key does not replay stale verdicts, it discards fresh
ones.

## Plugin packaging

### Marketplace catalog
An index that lets a Claude Code / OMP installer discover and pull a plugin
from a marketplace source. Distinct from the plugin manifest: the catalog
declares the marketplace and lists each plugin with a source, while the
manifest carries the plugin's authoritative name and version. A catalog
carries no version of its own — the version lives only in the manifest, so
the catalog is not a release surface.

### Version-sync surface
The explicit, enumerated set of manifests a release bump updates atomically.
A manifest not on the list is intentionally outside the gate: keeping a file
off the surface means its version can never drift out of step, and adding a
manifest to it is a deliberate decision, not a default.

## Flagged ambiguities

- "context" had been used for both the language (scope/position) and the
  evidence (adjacent code) — these are distinct; adjacent syntax is the
  only context that carries the mention.