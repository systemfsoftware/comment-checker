---
title: A trust flag set for a whole fragment instead of its edge disables every context-aware rule on that path
date: 2026-08-24
category: logic-errors
module: hook payload adaptation (Edit/MultiEdit fragment context) and the classifier's conservative fallback
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - "An added comment that restates its adjacent code blocks on a Write payload and passes on an Edit payload carrying byte-identical text"
  - "Only the text-only rules ever fire on Edit/MultiEdit: AgentMemo, CommentedOutCode, VacuousTodo. RestatesCode and NarratesControlFlow never appear"
  - "No test failed, no gate reddened, mutation score on the classifier stayed at 100%, and F1 stayed above its floor"
  - "The hook exits 0 on the tool an agent actually uses to modify an existing file, so the gate is inert exactly where it is load-bearing"
root_cause: scope_issue
resolution_type: code_fix
related_components:
  - testing_framework
  - development_workflow
tags: [gate-coverage, entry-path, trust-flag, fragment-edge, mutation-blind-spot, conservative-fallback, functional-core-shell]
---

# A conservative fallback is an acquittal channel; its guard's scope is the enforcement boundary

## Problem

`check` adapts three payload shapes into one comment stream. For `Write` it detects comments in the whole content; for `Edit` and `MultiEdit` it diffs comment sets and keeps only the newly-added ones, then stamps each surviving comment's `CommentContext` as untrusted. `classify` reads that flag twice: `reliable_adjacent` refuses to hand adjacent code to the context-aware detectors, and the terminal fallback rewrites an evidence-free `RestatesCode` verdict into `Justification::NonObviousIntent`.

Stamping the flag for every comment in the fragment therefore did not make the edit path *conservative*. It made the edit path *unenforced* for every rule that needs adjacent code — which is every rule the tool exists for.

## Mechanism

Let $R$ be the rule set, partitioned into text-only rules $R_t$ (decidable from the comment string) and context rules $R_c$ (requiring adjacent code). Let $u(c)$ be the trust flag on comment $c$, and $p$ the entry path.

The classifier's fallback gives, for any $c$:

$$
u(c) = \text{true} \;\Rightarrow\; \text{verdict}(c) \in R_t \cup \{\text{Justified}\}
$$

The adapter set $u(c) = \text{true}$ unconditionally for all $c$ on the edit paths. Substituting:

$$
\forall c \in p_{\text{edit}}:\; u(c) = \text{true} \;\Rightarrow\; R_{\text{effective}}(p_{\text{edit}}) = R_t
$$

$R_c$ is dead code on that path — not weakened, absent. A conservative default composed with an unconditional guard is not caution; it is a blanket acquittal wearing caution's name.

The soundness condition the flag was *meant* to encode is narrower. A fragment is a contiguous slice of file text. If $c$ has a following code sibling inside the slice, that sibling is also $c$'s following sibling in the whole file — the boundary cannot have inserted code between them. So trust is warranted whenever the side $c$ annotates is present within the slice, and unwarranted only in two shapes: no adjacent code captured at all, or the detector could read $c$ only as a trailing comment, which `derive_context` yields exactly when the next code sibling is absent. Hence:

$$
u(c) \;=\; \neg\,\text{adjacent}(c) \;\lor\; \text{position}(c) = \text{Trailing}
$$

## Why every gate stayed green

Three independent gates covered this subsystem and none could see the defect.

1. **Mutation coverage measured the wrong stage.** The mutation gate targets the pure classifier. The defect lived in the adapter that constructs the classifier's inputs. A pure core can be perfectly pinned while the shell feeding it supplies uniformly degraded inputs; every mutant of the core still dies, because the tests that kill them construct their contexts directly.

2. **The labelled corpus drove one entry path.** The evaluation harness synthesises a source snippet per case and runs it as a whole-content parse — the `Write` shape. Coverage of behaviour on the paths the harness never constructs is zero regardless of corpus size, label quality, or per-kind floors. Formally, with $P$ the entry paths and $G \subseteq P$ those the gate drives, a defect confined to $P \setminus G$ is unobservable through that gate.

3. **The composition tests asserted the defect as the contract.** Two tests named the blanket acquittal as intended behaviour and passed. A test that encodes the bug is worse than no test: it converts a defect into a protected invariant and makes the fix look like a regression.

The union of the three is the general trap: **a gate suite can be individually sound at every layer and still leave an entry path with no coverage at all**, because coverage composes over (stage $\times$ path), not over stages alone.

## Architectural Invariants

- **Guard scope equals the condition it names.** A flag called "the boundary may have removed context" must be true only where the boundary could have removed context. When a guard's scope exceeds its predicate, the excess is silent capability loss, not conservatism. Corollary: an unconditional assignment to a trust flag is always a bug or a constant.

- **Every acquittal channel is an enforcement hole with a scope.** Enumerate the ways a verdict can become Justified — matched exemption, fallback rewrite, unsupported input — and state the scope of each. A fallback that manufactures a specific justification for an unprovable case is indistinguishable, downstream, from having proven it.

- **Coverage composes over stage × entry path.** Mutation-testing a pure core certifies the core, not the adapters upstream of it. A labelled corpus certifies the paths it constructs, not the paths it does not. Any input shape the production entrypoint accepts is an axis the gate must enumerate.

- **A conservative default must degrade to a floor, not to the empty set.** State the floor explicitly and assert it. "Falls back to the text-only rules" is a floor; "falls back to Justified for everything unmatched" is an off switch.

- **A test that passes on the pre-fix artifact certifies nothing.** Gate authorship is only complete once the gate has been run against the defective revision and observed to fail. A gate never shown red is an untested assertion about an untested property.

## Verification

The falsifying observation to demand: identical comment text on two payload shapes must reach identical verdicts wherever the fragment supplies the annotated side.

| Probe | Expectation |
| --- | --- |
| restatement with code following it, inside the fragment | blocks, reason cites the shared tokens |
| same text as whole-content payload | blocks identically — the two paths must not disagree |
| comment at the fragment tail, nothing after it | passes — the genuine truncated edge |
| comment with no adjacent code in the fragment | passes — neither side captured |
| machine-read directive on a restating line | passes on both paths |

Session verification: the labelled corpus driven through the edit seam moved from 43 of 60 correct to 60 of 60. Seventeen unnecessary cases had been spared — fifteen restatement, two flow-narration — and zero justified cases were newly blocked, so the change carries no false-positive cost against the corpus. The whole-content path was unchanged on all sixty, confirming the fix is confined to the adapted paths. Operator mutation of the new predicate — disjunction to conjunction, equality to inequality, and each constant — is killed by the composition tests and the new edit-path gate.

## Prevention

- Enumerate the entry shapes the production entrypoint accepts, then drive the labelled corpus through each. Gate: per-path corpus invariants asserting no justified case blocks and no unnecessary case is spared.
- Before trusting a new gate, run it against the revision that contained the defect and require a red result naming the affected cases. Gate: the gate's own commit message records the pre-fix failure count.
- When a fallback rewrites a verdict, assert the floor it degrades to, not merely that it does not crash. Gate: a test per path asserting a context rule still fires where context is present.
- Treat an unconditional write to a trust or capability flag as a review stop. The predicate belongs in the assignment, not in the reader.
- When a test's name asserts that a detector is *not* consulted, verify that this is a decision and not a discovered behaviour that was pinned. Gate: this document.

## Related

- docs/solutions/design-patterns/evidence-gated-context-aware-classification.md — the evidence discipline applied to convictions; this document is the same discipline applied to acquittals, which that design left on an unconditional guard.
- docs/solutions/integration-issues/cached-gate-task-scope-exceeds-determinants.md — the sibling scope-mismatch failure. There a hash surface exceeded its determinants and destroyed cache value; here a guard's scope exceeded its predicate and destroyed enforcement. Both are audited by comparing a declared scope against the set it claims to track, in both directions.
