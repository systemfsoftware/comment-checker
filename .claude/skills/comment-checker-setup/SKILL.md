---
name: comment-checker-setup
description: Set up or repair a comment-checker PostToolUse hook. Use when comment-checker does not resolve or 'comment-checker did not run' appears on edits, or a flake/direnv/npm install path must be verified. Triggers on: 'comment-checker setup', 'hook not running', 'doctor the comment checker'. Do not use for comment-writing advice or unrelated hook debugging.
---

# comment-checker-setup

Install and verify the comment-checker `PostToolUse` hook so every edit is checked. A hook that cannot resolve its binary checks nothing: it must either find `comment-checker` on PATH or reach it through the direnv bridge, and the whole chain must be proven with the bundled doctor, never by eyeballing a shell.

## When to Activate

```yaml
- id: A1
  title: Activate on setup or repair intent
  do: activate when the task is installing, wiring, or diagnosing the comment-checker hook, or when 'comment-checker did not run' appears on edits
  dont: activate for comment-style feedback on code you are writing, or for generic hook debugging unrelated to comment-checker
  check: the request names the hook, the binary, or the 'did not run' symptom
- id: A2
  title: Boundary - do not activate for comment writing advice
  do: for advice about which comments to write or remove, note that comment-checker itself (called as the hook) is the authority and stop
  dont: apply this skill's setup workflow to comment-content questions
  check: the ask is about wiring, not about a specific comment's merits
```

## Workflow: provision and verify

```yaml
- id: W1
  title: Run the doctor first
  do: run `./scripts/doctor.ts [project-dir]` from a clean environment (no ambient dev-shell PATH), and let its output drive the fix
  dont: skip the doctor and hand-edit PATH or directories on suspicion; a resolution failure is traced, not guessed
  check: the doctor exits 0, or each broken check carries a fix hint you applied
- id: W2
  title: Resolve binary on PATH first
  do: ensure `comment-checker` resolves on PATH (npm global install, or a dev shell that provides it); `command -v comment-checker` from a clean shell must print a path
  dont: rely on a dev shell you are not provably inside; hook subprocesses do not inherit your interactive shell's direnv state
  check: `env -i PATH=/usr/bin:/bin sh -c 'command -v comment-checker'` finds it, or the direnv bridge covers the gap
- id: W3
  title: Wire the direnv bridge when the repo is flake-based
  do: when the project has a flake.nix that provides the binary, add `.envrc` containing `use flake` and run `direnv allow`; the hook falls back to `direnv exec` when PATH misses
  dont: stop at `direnv allow` -- a blocked .envrc loads nothing, so verify with `direnv exec . command -v comment-checker`
  check: the doctor's direnv bridge check reports [ok]
- id: W4
  title: Prove the exit-code contract
  do: feed a restating-comment payload and a clean payload to the binary and assert exit 2 and exit 0 respectively (the doctor does this)
  dont: accept 'the binary runs' as 'the hook works' -- presence is not the contract
  check: the doctor's exit-code contract check reports [ok]
- id: W5
  title: Name the real provider in the final report
  do: state which provider the project uses (npm global, direnv+flake, or nix develop) and that the doctor verified it end-to-end
  dont: leave the resolution mechanism implicit or report 'verified' without the doctor run
  check: the report names the provider and cites the doctor exit code
```

```bash
# exact commands for W2-W4 (run from the project root)
env -i PATH=/usr/bin:/bin sh -c 'command -v comment-checker'   # W2 path probe
printf 'use flake\n' > .envrc && direnv allow                   # W3 wiring
direnv exec . command -v comment-checker                         # W3 verify
```

## Common failures

```yaml
- id: F1
  title: Ambiguous PATH shadowing
  do: when the doctor's identity check fails, treat 'a different program named comment-checker' on PATH as the cause and remove/reorder it
  dont: assume the shadowing binary is the real checker just because it answers
  check: the doctor's binary identity check reports the expected `claude-code-comment-checker <semver>` line
- id: F2
  title: Blocked .envrc
  do: when the direnv bridge fails with 'is blocked', run `direnv allow` and re-run the doctor
  dont: edit .envrc contents to make the error go away
  check: `direnv exec . command -v comment-checker` resolves
- id: F3
  title: Hook file missing
  do: when the doctor reports no hook wiring, install the plugin or add the PostToolUse entry to `.claude/settings.json`
  dont: ship a binary with no hook attached and call the setup done
  check: the doctor's hook wiring check reports [ok]
```

## Verification

```yaml
- id: V1
  title: Doctor is the gate
  do: run `./scripts/doctor.ts .` and require exit 0 before claiming the hook works
  dont: claim 'the comment checker is set up' from a PATH or directory listing alone
  check: the doctor prints 'all checks passed' and exits 0
- id: V2
  title: Doctor scripts stay green
  do: after any edit to `scripts/doctor.ts`, run `deno check doctor.ts && deno lint doctor.ts` (in `scripts/`)
  dont: ship a doctor that does not typecheck or lint clean
  check: both `deno check` and `deno lint` exit 0 in the scripts directory
```

## Scripts

| Script | Purpose | When to run |
|--------|---------|-------------|
| `scripts/doctor.ts` | Probes resolution, identity, contract, hook wiring, direnv bridge, flake dev shell; exits 0 all-pass, 1 broken | First, and after every fix |

## References (load on demand)

| Reference | When to load (intent) | Hash |
|-----------|--------------|------|
| `references/setup-resolution.md` | Resolve which provider path applies, or when PATH/direnv/nix ordering matters | `5bed20` |

## Integration

```yaml
- id: I1
  title: Coordinate with the agent-harness design
  do: when the harness that runs the hook needs a path or env change, design it together with this skill's wiring (one change, not two)
  dont: treat the hook wiring as isolated from how the harness spawns subprocesses
  check: the resolution falls out of the harness's own env, not a workaround
```

## Critical Rules at Document End

```yaml
- id: END1
  title: A hook that does not resolve checks nothing
  do: prove resolution and the exit-code contract with the doctor from a clean environment before trusting the hook
  dont: trust a shell you happened to be in, or a direnv state you did not verify
  harm: an unverified hook silently checks zero edits, and the failure is invisible until bad comments ship
  check: `./scripts/doctor.ts .` exits 0 from a clean env
- id: END2
  title: Never edit the body to chase a failing eval
  do: when a check fails, attribute the cause (resolution, identity, wiring) from the doctor's output and fix that, not the skill text
  dont: weaken the skill's rules because a fixture fails
  harm: editing the skill on an unattributed failure ships the drift
  check: every body edit traces to a diagnosed cause, not to a failing run
```

## Do not use for

- Writing or judging code comments in your own work — invoke the checker as the hook does.
- Debugging hook subprocess env unrelated to comment-checker (PATH drop, plugin host) — that is the agent-harness-design skill's surface; cross-reference by capability, never by name.