---
title: Turbo-cached mutation gate replays stale verdicts when the toolchain definition misses the cache key
date: 2026-08-21
category: integration-issues
module: cargo-mutants mutation gate (turbo mutants task + CI mutation job cache)
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "A flake.nix-only edit replayed the previous cargo-mutants verdict verbatim: the turbo task hash did not move and the run reported a local cache hit"
  - "Changing the dev-shell toolchain (the cargo-mutants version lives in the flake's devShells.default package list) did not invalidate the cached verdict, so a stale green could replay instead of a fresh run"
  - "Inverse CI-side symptom: config-only edits moved turbo's own hash but not the actions/cache bag key, so the gate re-executed on every CI run and the fresh verdict was never persisted (exact-key restore suppresses the post-job save — documented actions/cache behavior, per the CI workflow's own cache-step comment)"
root_cause: config_error
resolution_type: config_change
related_components:
  - development_workflow
  - testing_framework
tags: [turbo, cargo-mutants, mutation-testing, cache-key, flake, actions-cache, stale-cache, hash-coverage]
---

# Mutation gate cache hashed the toolchain pin but not the toolchain definition

## Problem

The turbo `mutants` task — the cached cargo-mutants gate over the core classifier — hashed the nix lockfile as an input but not the flake that defines the dev-shell toolchain, including the cargo-mutants version. An edit confined to the toolchain definition therefore left the task hash untouched and turbo replayed the previous verdict without running the mutant loop. The same class of gap existed one level up: the CI mutation job's actions/cache key did not cover the files turbo hashes beyond the task's declared inputs, so config-only edits re-executed the gate every run while the restored exact key suppressed the save — the fresh verdict never persisted.

## Symptoms

- Editing the toolchain definition did not invalidate the mutation gate; turbo replayed the previous verdict verbatim (task hash unchanged, local cache hit reported).
- Config-only edits (task options, the npm launcher's gate script) moved turbo's internal hash but not the CI bag key; the gate re-executed every CI run and nothing was saved back.
- No error, no warning: a stale replay is indistinguishable in output from a correct one. Only the absence of the expected multi-minute runtime exposes it.

## What Didn't Work

- **Trusting the task's input list as proof of coverage.** The list looked complete — lockfile, workspace config, source globs. An input covers only the file it names; the toolchain definition was simply absent. A reading pass cannot prove hash coverage; only a hash-movement probe can.
- **Treating the CI cache key as an independent ledger.** The transport cache (actions/cache) is a bag labeled by its key, not a second opinion. When the bag key is a strict subset of the engine's hash surface, unchanged inputs restore an exact key, and exact-key restore suppresses the post-run save — so any edit outside the bag key re-executes forever without persisting.
- **Two adversarial hypotheses, falsified by probe — do not re-argue them:**
  - *False: "editing the gate script body replays stale verdicts."* Turbo self-hashes the task's package script body. Editing the launcher's `scripts.mutants` entry moved the hash and forced a miss. Script bodies are covered automatically; they need no explicit input.
  - *False: "env or option changes replay stale verdicts."* Turbo hashes declared env values and its own task options. A probe setting a divergent `CARGO_BUILD_JOBS` value moved the hash and missed. Divergent environment busts the cache; it never replays.

## Mechanism

A cached verdict is sound if and only if every determinant of the verdict is in the key:

```
stale replay possible  <=>  Determinants(verdict) \ Inputs(hash) != {}
```

Determinants here: mutation-target sources and tests, workspace manifests, dependency lockfiles, toolchain definition + toolchain pin, build config, and the gate command itself. The bug was a single-element set difference: the toolchain definition file. Turbo's automatic hashing covers the script body and declared env values — never arbitrary repository files outside the package — so any file whose bytes change the verdict must appear in the task's explicit input list.

The transport layer adds a second condition. The CI bag key must be a superset of the engine's full hash surface:

```
bag key ⊇ turbo hash surface   (else: exact-key restore suppresses save)
```

A violation does not replay stale verdicts — turbo's own hash still gates replay — but it discards every fresh verdict produced under a hash the bag key cannot distinguish, turning the cache into a permanent re-execute.

## Solution

Fix on branch `turbo-rust` (PR opening on that branch), pending merge as of
this writing.

1. Add the toolchain definition to the task's explicit inputs, beside the toolchain pin that was already there:

```
"inputs": [
  "$TURBO_ROOT$/package.json",
  "$TURBO_ROOT$/Cargo.toml",
  "$TURBO_ROOT$/Cargo.lock",
  "$TURBO_ROOT$/flake.lock",
  "$TURBO_ROOT$/flake.nix",
  "$TURBO_ROOT$/.cargo/config.toml",
  "$TURBO_ROOT$/crates/comment-checker/Cargo.toml",
  "$TURBO_ROOT$/crates/comment-checker/src/**",
  "$TURBO_ROOT$/crates/comment-checker/tests/**"
]
```

2. Widen the CI mutation job's actions/cache `hashFiles` key to a superset: the task input set above, plus the two descriptors turbo self-hashes (the turbo config and the npm launcher package manifest carrying the gate script). A narrower key silently discards fresh verdicts.
3. Restore build-state caching for the miss path (registry, git checkouts, target dir), keyed on the dependency lockfile + toolchain pin, sharing a common restore-key prefix with the gate job's build cache.
4. Set the build-jobs env var explicitly on the mutation run line, matching the gate job — declared env values are hash inputs, so an unset-or-varies value makes local and CI keys diverge for no reason.

## Architectural Invariants

- **Hash-coverage completeness:** every file that can change the verdict must be in the task's input list. Automatic coverage extends only to the script body and declared env values. Corollary: when moving a gate behind a cache, enumerate its determinants first, then make the input list equal that enumeration.
- **Transport-key superset:** a transport cache wrapped around a content-addressed engine must key on a superset of the engine's own hash surface, because exact-key restore suppresses the save. Subset keys do not corrupt verdicts; they discard deposits.
- **Probe, don't trust:** membership in the hash is an empirical property of the engine version in use. Establish it by editing the file alone and observing hash movement, not by documentation or intuition.
- **A stale verdict is observationally identical to a fresh one.** Never disable caching to fix staleness; fix the key. The only honest signal of a replay is missing execution time.

## Proof protocol

Probe with the engine's dry-run hash report (`turbo run mutants --dry=json` or equivalent), editing one file at a time:

| Edit under test | Expected hash | Expected cache event |
| --- | --- | --- |
| toolchain definition (post-fix) | changes | miss + re-execution |
| gate script body | changes | miss (self-hashed) |
| declared env value | changes | miss (env-hashed) |
| no change / reverted file | unchanged | hit (full replay) |

Session verification (2026-08-21, four runs): input-set change -> miss, 117 mutants, 113 caught, 4 unviable, 0 survived, ~2m36s; unchanged -> hit in 10 ms; toolchain-definition edit -> miss, full re-execution; revert -> hit in 8 ms. The pre-fix behavior — toolchain edit leaving the hash unchanged and replaying — was the defect this loop reproduced and closed.

## Prevention

- When a file must invalidate a cached gate, add it to the task's explicit inputs. Gate: the probe above — edit the file alone, the dry-run hash must change; revert, it must not.
- Keep the transport cache key a superset of the engine hash surface. Gate: whenever an input is added to the task, diff the transport key's file list against the task inputs plus self-hashed descriptors; every engine-side input must appear.
- Do not put a value in declared task env that must not be a hash input; every local variance busts the team cache. Gate: the env-value probe row above.
- Record falsified hypotheses (script-body staleness, env staleness — both false) so the coverage boundary is not re-litigated from intuition. Gate: this document.

## Related

- docs/solutions/design-patterns/evidence-gated-context-aware-classification.md — the classifier gate whose verdict this cache transports; its enforcement section is the upstream consumer.
- docs/solutions/architecture-patterns/rust-cli-npm-distribution.md — shares the CI surface and the gate-the-derived-surface discipline.
