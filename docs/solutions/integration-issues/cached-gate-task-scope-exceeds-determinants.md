---
title: A cached gate whose task scope exceeds its determinant scope has a hit rate of zero on the runs that matter
date: 2026-08-21
updated: 2026-08-23
supersedes_own_prior_revision: true
category: integration-issues
module: cargo-mutants mutation gate (cached mutation task + CI mutation job transport cache)
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "The mutation gate re-executed its full multi-minute mutant loop on every release run while reporting a restored transport cache in the same job"
  - "Engine log reads `cache miss, executing <hash>` immediately after the transport step reports `Cache restored successfully` — two caches, one hit, one miss, same job"
  - "Transport post-job reports `Cache hit occurred on the primary key ..., not saving cache`, so the freshly computed verdict is discarded and the next identical run misses again — the miss never self-heals"
  - "Earlier inverse symptom in the same subsystem: a toolchain-definition-only edit left the engine hash unmoved and replayed a stale verdict"
root_cause: config_error
resolution_type: config_change
related_components:
  - development_workflow
  - testing_framework
tags: [turbo, cargo-mutants, mutation-testing, cache-key, task-scope, actions-cache, determinant-set, hash-coverage, spurious-invalidation]
---

# Task scope must equal determinant scope, or the cache is decoration

## Problem

The mutation gate — a cached `cargo mutants` run over the core classifier — was declared as a **package-scoped** task owned by the npm launcher package, while its command escaped that package to run at the repository root against the Rust crate. The build engine unconditionally hashes the owning package's manifest into a package-scoped task hash. That manifest carries the launcher's published version, which the release automation rewrites on every release. The version field is not a determinant of a mutation verdict, yet it sat in the verdict's cache key, so every release produced a fresh hash and a guaranteed full re-execution.

The transport layer then made the miss permanent. The CI transport cache key hashed only the true determinants, so it *hit* while the engine hash *missed*. Exact-key restore suppresses the post-job save, so the fresh verdict computed under the new hash was thrown away every time. Two keys for one artifact, moving independently: the cache could never converge.

## Symptoms

- Engine reports `cache miss, executing <hash>` in the same job where the transport step reports a successful restore.
- Transport post-job reports `Cache hit occurred on the primary key ..., not saving cache` — the deposit is refused precisely when it is needed.
- The re-execution correlates with release commits, not with source changes: a version bump and changelog append are sufficient to force it.
- No error and no warning at any layer. Each layer is behaving as documented; only the wall-clock cost reveals the defect.
- Inverse historical symptom in the same subsystem: an edit confined to the dev-shell toolchain definition left the hash unmoved and replayed a stale verdict.

## What Didn't Work

- **Reading the declared input list as proof of the hash surface.** The declared inputs named only Rust sources, manifests, lockfiles and the toolchain pin. The launcher manifest appeared in the hash anyway, because package-scoped tasks hash their owner's manifest automatically. A declared-input audit cannot see automatic inputs; only a hash-movement probe can.
- **Widening the transport key to chase the engine.** This is the prior revision's prescription and it is sound but unstable: it makes the key a maintenance dependency of an implicit, engine-version-specific set. It drifted the moment the toolchain-pin change rewrote the determinant list, and the drift was silent.
- **Treating the transport cache as a second opinion.** It is a bag labelled by its key, not a verdict store. A bag hit says nothing about whether the bag contains the entry the engine wants.
- **Two falsified hypotheses — do not re-litigate:**
  - *False: "editing the gate command body replays a stale verdict."* The engine self-hashes the task's script body; editing it moves the hash and forces a miss. Command bodies need no explicit input.
  - *False: "environment or task-option changes replay stale verdicts."* Declared environment values and task options are hashed; a divergent build-jobs value moved the hash and missed.

## Mechanism

Let $D$ be the determinant set of a verdict — every byte whose change can legitimately change the outcome — and $I$ the engine's actual hash input set, automatic inputs included. Two independent failure directions exist, and the prior revision of this document covered only the first:

$$
D \setminus I \neq \emptyset \;\Rightarrow\; \textbf{stale replay (unsound)}
$$
$$
I \setminus D \neq \emptyset \;\Rightarrow\; \textbf{spurious invalidation (sound, zero value)}
$$

Soundness requires $D \subseteq I$. **Usefulness requires $I \subseteq D$.** A cache is worth its complexity only at $I = D$.

Spurious invalidation is not uniformly harmless. Let $p$ be the probability that a member of $I \setminus D$ is mutated between two runs. Hit rate is bounded by $1 - p$. When a member of $I \setminus D$ is written by the *release automation itself*, $p = 1$ on release runs, so:

$$
\text{hit rate on release runs} = 0
$$

The cache then costs storage, key maintenance and reader confusion while returning nothing on exactly the runs whose latency is most visible.

The source of $I \setminus D$ here was **scope mismatch**. A package-scoped task inherits its owner package's manifest as an automatic hash input. The gate's determinants lived entirely outside that package — the command's own first act was to leave it. Therefore:

$$
\text{scope}(\text{task}) \neq \text{scope}(D) \;\Rightarrow\; I \setminus D \supseteq \{\text{owner manifest}\}
$$

The transport layer adds the second condition. Let $K$ be the transport bag key surface:

$$
K \subsetneq I \;\Rightarrow\; \exists\, \text{engine-hash change with no key change} \;\Rightarrow\; \text{exact-key restore} \;\Rightarrow\; \text{save suppressed}
$$

A subset key does not corrupt verdicts — the engine hash still gates replay — but it **discards every deposit** made under a hash the key cannot distinguish, converting the cache into a permanent re-execute. Note the interaction that made this defect self-sustaining: the scope mismatch inflated $I$ with a field absent from $K$, so $K \subsetneq I$ held for exactly the field that changed every release.

## Solution

Collapse both conditions by making scope, determinants and key coincide, rather than maintaining a superset relation between three independently-edited surfaces.

1. **Re-scope the task to a root task.** A gate whose command reads outside its own package is a root-workspace task, not a package task. Declaring it at the root removes the launcher manifest from $I$ entirely, because the root task's owner is the workspace itself. The gate command moves to the root workspace manifest's script table; the launcher manifest loses the script it never legitimately owned.
2. **Give the cached form a distinct invocation name.** A root task executes the identically-named script from the root manifest, so a script that shells back into the engine for the same task name recurses. Keep the raw command under the task's own name and expose the cached entrypoint under a distinct name.
3. **Declare $I$ as exactly $D$**: mutation-target sources and tests, the crate manifest, the workspace dependency manifest and lockfile, the build config, and the toolchain pin. Nothing else. Every prior member of $I \setminus D$ — the launcher manifest, and the nix flake and its lock, which the toolchain-pin change had already made non-determinants — stays out.
4. **Set the transport key to the same enumeration**, plus the descriptors the engine self-hashes for a root task (the workspace task configuration and the root workspace manifest). With $K = I = D$ the three surfaces move together by construction and cannot drift apart under later edits.

## Architectural Invariants

- **Scope–determinant identity.** A cached task must be declared at the scope of its determinants. A command whose first action leaves its own package is misfiled; re-scope it rather than compensating downstream. Corollary: any automatic hash input that is not a determinant is a latent hit-rate bug, and one written by automation is a guaranteed one.
- **Two-sided key correctness.** $D \subseteq I$ buys soundness; $I \subseteq D$ buys value. Audit both directions. A cache audit that checks only for missing inputs will certify a cache with a hit rate of zero.
- **Release-mutated fields are never cache inputs.** Version strings, changelog bodies and other release artifacts are outputs of the shipping process. Any of them inside a gate's hash sets $p = 1$ on release runs.
- **Transport keys co-move with engine hashes.** A transport cache wrapped around a content-addressed engine must key on a surface that changes whenever the engine hash changes. Subset keys silently refuse deposits, because exact-key restore suppresses the save. Prefer equality by construction over a maintained superset: a superset is a standing obligation on every future edit to either surface.
- **Probe, don't trust.** Hash membership is an empirical property of the engine version in use. Establish it by mutating one file and observing hash movement, never from documentation or intuition. Automatic inputs are invisible to a reading pass of the declared inputs.
- **A stale verdict is observationally identical to a fresh one; a spurious miss is observationally identical to a real one.** Neither is discoverable from the pass/fail signal. Never disable caching to fix either — fix the key.

## Proof protocol

Probe with the engine's dry-run hash report, mutating one surface at a time, and assert on both the reported input key set and the hash:

| Edit under test | Expected input set | Expected hash | Expected cache event |
| --- | --- | --- | --- |
| release version bump + changelog append | launcher manifest absent | unchanged | hit (full replay) |
| mutation-target source | present | changes | miss + re-execution |
| toolchain pin | present | changes | miss + re-execution |
| gate command body | self-hashed | changes | miss |
| declared env value | env-hashed | changes | miss |
| no change / reverted | — | unchanged | hit |

Session verification (2026-08-23): pre-fix input set contained the launcher manifest alongside twenty Rust determinants, confirming $I \setminus D \neq \emptyset$ by direct report rather than inference. Post-fix, the input set contained only determinants plus the root descriptors the engine self-hashes. Cold run: miss, $117$ mutants, $113$ caught, $4$ unviable, $0$ survived, ~2m4s. Immediate re-run: hit, 9 ms. Simulated release bump — version rewritten and changelog appended, exactly the release automation's edit — hit, 8 ms. Pre-fix that same edit forced a full ~4 minute re-execution whose result was then discarded by the transport layer.

The falsifying observation to demand before believing any fix here: a release-shaped edit followed by a cache **hit**. A passing gate proves nothing about the cache.

## Prevention

- Before declaring a cached task, enumerate its determinants, then declare it at the narrowest scope containing all of them and nothing else. Gate: the dry-run input report must equal that enumeration — check for extra members, not only missing ones.
- Never let release automation write a file inside a gate's hash surface. Gate: the release-bump probe row above must show an unchanged hash.
- Set the transport key equal to the engine's full surface rather than a superset, so the two cannot drift. Gate: whenever either surface changes, re-run the release-bump and source-edit probe rows; a key hit paired with an engine miss is the signature of drift.
- A command that changes directory out of its own package is the grep-able smell for scope mismatch. Treat it as a re-scope trigger, not a portability detail.
- Record falsified hypotheses (command-body staleness, env staleness — both false; transport-key widening — sound but unstable) so the coverage boundary is not re-derived from intuition. Gate: this document.

## Related

- docs/solutions/design-patterns/evidence-gated-context-aware-classification.md — the classifier gate whose verdict this cache transports; its enforcement section is the upstream consumer.
- docs/solutions/architecture-patterns/rust-cli-npm-distribution.md — shares the CI surface and the gate-the-derived-surface discipline; the release automation that rewrites the launcher version is described there.
