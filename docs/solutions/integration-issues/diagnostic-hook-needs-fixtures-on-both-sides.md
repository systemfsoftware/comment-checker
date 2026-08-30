---
title: "Diagnostic hooks need fixtures on both sides - a doctor must be run from a foreign cwd and against a working provider before it ships"
date: 2026-08-30
category: integration-issues
module: comment-checker
problem_type: integration_issue
component: dev-tooling
symptoms:
  - "a comment-checker doctor reported 4 check(s) broken on a fully working npm-global setup"
  - "running the doctor from an unrelated cwd fabricated false negatives for hooks and direnv"
  - "the hook-wiring check passed on a settings.json with no comment-checker entry"
root_cause: "diagnostic probes assumed the ambient cwd and the only provider path, so they never saw the architectures that would break them"
resolution_type: code_fix
severity: medium
tags: [doctor, diagnostics, comment-checker, fixtures, provisioning]
---

# Diagnostic hooks need fixtures on both sides

## Problem

A setup-doctor for the comment-checker hook returned `4 check(s) broken` on a
working npm-global install, and returned `no hook file found` on a project
that had one. The doctor's verdicts disagreed with reality in both directions:
false-broken on healthy setups, and a false-pass when a `settings.json`
existed but had no comment-checker entry.

## Root cause

Three probe defects, each a different assumption:

1. **Path anchoring.** The doctor read `.envrc`, `.claude`, and `hooks` from
   its own cwd, not from the project directory it was asked to check. Run from
   an unrelated cwd, every probe missed its target and reported broken.
2. **Provider myopia.** The doctor demanded a `.envrc` even when
   `comment-checker` already resolved on PATH. The hook's real resolution is
   PATH first, direnv only as fallback; a setup with the binary on PATH needs
   no `.envrc`, and demanding one is a false-broken.
3. **Presence-blind wiring.** The hook-wiring check accepted any existing
   `settings.json` as wired, without parsing whether a `PostToolUse` entry
   actually referenced `comment-checker`. A file with no entry passed.

## Solution

- Anchor every probe on the resolved project directory, and grant read access
  to that directory absolutely (not to relative names that resolve against the
  doctor's own cwd).
- Model the hook's actual resolution matrix: PATH first, then direnv. When the
  binary resolves on PATH, report the direnv bridge as "not needed".
- Parse candidate hook files and require a `PostToolUse` entry whose command
  references `comment-checker` before reporting the wiring as present.
- Prove each verdict with fixtures on both sides of the boundary: a working
  provider that must exit 0, and a broken provider that must exit 1.

## Why This Works

A doctor is a decision procedure over reality. It is only trustworthy when its
positive and negative verdicts are both exercised against real shapes: a
healthy setup that must pass, and each broken shape that must fail. A doctor
tested only against the author's own working setup cannot see the assumptions
that break elsewhere.

## Prevention

- Any new diagnostic probe ships with a fixture on both sides of its verdict:
  one that must pass and one that must fail, run from a foreign cwd.
- Never grant read access by a relative name that resolves against the
  doctor's own cwd; resolve the target directory first.
- A presence check must parse, not merely exist: a hook file with no
  comment-checker entry is not "wired".