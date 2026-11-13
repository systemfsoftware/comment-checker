---
problem_type: build_error
---

# Cold CI Jobs Download the Vendored Subtrees Through the Repository Archive

## Symptom

A PR check spent 70-90% of its job time on setup. In effect-microvm's commitlint job (run 43364358441,
job 131685134087) nine `unpacking 'github:...'` lines ran one after another for about 90 s of a 134 s `nix develop` step.

## Cause

A `github:` flake input is fetched as the repository's GitHub archive. This repository's archive was 47 MB
compressed because `repos/` holds the vendored upstream subtrees (155 MB, 22670 files), which no flake, workflow or
action reads.

## Fix

`/repos/ export-ignore` in `.gitattributes`: GitHub's archive, `git archive` and the Nix `github:` fetcher honour it,
and a checkout still holds the subtrees.
