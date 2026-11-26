---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
created: 2026-11-26
updated: 2026-11-26
type: feat
title: Ship comment-checker sandboxed by default - Plan
---

# Ship comment-checker sandboxed by default

## Goal Capsule

- **Objective:** `packages.comment-checker` and `packages.default` run the binary inside a hardened sandbox on Linux (`bubblewrap`) and macOS (`sandbox-exec`), and `packages.comment-checker-unwrapped` is the raw binary. CI proves the sandbox by running the binary, on `x86_64-linux` and `aarch64-linux`.
- **Means:** Replace the current `mkBwrap` (Linux-only, binds `/etc`, `/usr`, `/proc`, keeps the host environment, unshares only the network) with a `mkSandbox` ported from the hardened baseline: `--unshare-all --new-session --clearenv --die-with-parent`, only `/nix/store`, `/dev`, `/tmp` and the working directory bound, the `$PWD` character guard, and a macOS seatbelt profile with stderr filtering. Add a conformance probe and a script that runs it and the real binary, wire both into CI on both architectures, and push both outputs.
- **Product authority:** owner design ruling: a CLI tool repository owns its own runtime sandbox and ships it as the default; the sandboxed build is not an opt-in extra, and no consumer policy API is added.
- **Open blockers:** None.
- **Execution profile:** code. `flake.nix`, a probe script, a conformance script, two workflow files, docs.
- **Stop conditions:** conformance green on `x86_64-linux` and `aarch64-linux`; the macOS package evaluates; `comment-checker` and `comment-checker-unwrapped` both build and are pushed by `nix-cache-push` on `main`.
- **Tail ownership:** `ce-work` after this plan is written.

---

## Product Contract

### Summary

`comment-checker` is a `PostToolUse` hook that parses a payload on stdin and never opens a socket. That makes it a small, high-value target: it runs on every `Write`/`Edit` in an agent session. Today's flake wraps it in a Linux-only `bubblewrap` call that binds `/etc`, `/usr`, `/proc` and every parent environment variable, unshares only the network namespace, and has no working-directory guard and no macOS story. This plan replaces that wrapper with the hardened baseline the tool's own consumers already run locally: a full namespace unshare, a cleared environment, no `/proc`, `/etc`, `/usr` or `/lib` bind, a guarded working directory, and a macOS seatbelt profile. The raw build stays available as `<tool>-unwrapped` for a host that already provides an outer sandbox.

### Requirement

The owner's requirement: each tool repository carries its own hardened sandbox inside its own flake and ships the sandboxed build as its package and `default`; a raw build stays only as an output the sandbox wraps; each repository's conformance check is its own, in its own CI, and it runs the binary. There is no shared sandbox library and no `wrap` forwarder.

### Requirements

- R1. `packages.<system>.comment-checker` and `packages.<system>.default` are the sandboxed build; `packages.<system>.comment-checker-unwrapped` is the raw build.
- R2. The Linux wrapper unshares all namespaces, clears the environment, starts a new session, and binds only `/nix/store`, `/dev`, a tmpfs `/tmp`, and a working directory that passes the `[A-Za-z0-9_/.-]` guard. It does not bind `/proc`, `/etc`, `/usr` or `/lib*`.
- R3. The macOS wrapper runs the same guard and a seatbelt profile that denies by default, allows only the runtime's needs, and filters `sandbox-exec`'s deprecation warning from stderr while preserving the child's exit status.
- R4. The working directory is optional for this tool: an unsafe directory drops the read grant but the hook still checks its stdin payload.
- R5. A conformance check runs the packaged binary and proves, by running a probe unwrapped and then through the same sandbox builder, that the network is unreachable, the user's home cannot be read, a planted environment secret is absent, and the working directory is read-only; and that the tool's stdout, stderr and exit code pass through unchanged. A check that only reads the wrapper's text does not satisfy this.
- R6. CI runs the conformance check on `x86_64-linux` and `aarch64-linux`, and evaluates the macOS package. `nix-cache-push` on `main` pushes both outputs.

### Scope Boundaries

**In scope:** `flake.nix`, `nix/sandbox-probe.sh`, `scripts/sandbox-conformance.sh`, `.github/workflows/sandbox.yml`, `.github/workflows/ci.yml`, `.github/workflows/nix-cache-push.yml`, `README.md`.

**Deferred/Out:** the binary itself; the classifier; the npm packaging; a consumer policy API; a shared library.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. The tool repository owns the sandbox.** No shared library, no `wrap` forwarder. The same `mkSandbox` function builds the shipped wrapper and the conformance probe, so the flags CI proves cannot drift from the flags that ship.
- **KTD2. Port the hardened baseline, not the current wrapper.** The current `mkBwrap` is a regression source: it mounts `/proc` inside the PID namespace, which fails on hosts that forbid it, and it leaks the host environment. The ported flags are the ones measured to deny all five properties (below).
- **KTD3. Prove by differential, not by grep.** The probe is a small script that reports what it can reach. The conformance script runs it once unwrapped (the control: network reachable, canary readable, secret visible, cwd writable) and once through the sandbox (all four denied). A probe that silently lacks a feature would otherwise read as "denied"; the control rules that out. Pass-through is proven on the real binary.
- **KTD4. Lift the AppArmor restriction in CI.** Stock Ubuntu runners set `kernel.apparmor_restrict_unprivileged_userns=1`, which makes an unprivileged `bubblewrap` fail. The conformance job sets it to `0` before running. This is a runner prerequisite, recorded here and in the README, not a weakening of the sandbox.

### Assumptions

- A1. A `PostToolUse` payload carries the file content, so the hook works with no working-directory grant.
- A2. The macOS package only needs to evaluate in this repository's CI; no macOS runner is provisioned here, so the seatbelt wrapper is not executed in CI.

### Measured Answers To The Open Questions

These were measured, not assumed.

1. **Can a GitHub `ubuntu-latest` runner and an `ubuntu-24.04-arm` runner run `bwrap --unshare-all`?**
   - On stock settings, **no**. Both images set `kernel.apparmor_restrict_unprivileged_userns=1`. An unprivileged `bubblewrap` (nixpkgs 0.12.0, and 0.13.1) fails with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. The Ubuntu-packaged `bubblewrap` 0.11.1 succeeds on `ubuntu-latest` only because Ubuntu ships it setuid/AppArmor-profiled; on `ubuntu-24.04-arm` the packaged 0.9.0 fails the same way.
   - After `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, **yes**: `--unshare-all`, `--clearenv` and `--tmpfs /tmp` all exit `0` on both runners.
   - Measured on `ubuntu-latest` (image `ubuntu-26.04`, `x86_64`) and `ubuntu-24.04-arm` (image `ubuntu-24.04-arm`, `aarch64`).
2. **Do checkout paths in CI and in `wt` worktrees stay within `[A-Za-z0-9_/.-]`?**
   - CI: `GITHUB_WORKSPACE=/home/runner/work/comment-checker/comment-checker`, measured on both runners. All characters are in the set.
   - `wt` worktrees: 194 worktree directories under a working tree, none with a character outside the set, and no branch name containing `@`, `+` or a space.
3. **Which environment variables does the tool need?**
   - None. `comment-checker` runs a clean payload and a flagged payload under `env -i` and produces the same result as with the inherited environment: exit `0` and the skip note on stdout for clean input, exit `2` and the report on stderr for flagged input. The wrapper sets no environment at all (`--clearenv`).
4. **Which other repositories consume this flake?**
   - Public consumers whose `flake.nix` declares evidence of this input: `are-the-types-wrong-effect`, `effect-endgame-starter-kit`, `frontend`, `omp-claude-compat`, `pnpm-release-management`, `stryker-js-effect`, `systemfsoftware`, `xstate`. A further set of private repositories also consume it; they are not named here. This change does not modify any of them: their input follows the default branch, so the sandboxed default reaches them through a lock bump they choose.

---

## Implementation Units

### U1. Replace the wrapper with `mkSandbox`

- **Goal:** The shipped package is the hardened sandbox on Linux and macOS, and the raw build is a separate output.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** none
- **Files:** `flake.nix`
- **Approach:** One `mkSandbox { name, binary, cwdMode }` builds a Linux wrapper (`bubblewrap`, `--unshare-all --new-session --clearenv --die-with-parent`, binds `/nix/store`, `/dev`, `/tmp`, guarded cwd) and a macOS wrapper (seatbelt profile, guarded cwd subpath, stderr filter, exit-status preservation). `packages.comment-checker` and `default` use it around `comment-checker-unwrapped`; the npm workspace packages stay Linux-only; the dev shell puts the sandboxed package on `PATH`.
- **Verification:** `nix eval` for both Linux systems and `aarch64-darwin`; the sandboxed binary prints its version.

### U2. Add the probe and the conformance script

- **Goal:** A check that runs the binary and proves the five properties.
- **Requirements:** R5
- **Dependencies:** U1
- **Files:** `nix/sandbox-probe.sh`, `scripts/sandbox-conformance.sh`
- **Approach:** The probe uses only shell builtins so it runs inside the bound store: it attempts a TCP connect, opens a canary path passed as its argument, prints a secret from the environment, and writes into the working directory. `checks.<system>.sandbox-probe-raw` is the probe; `checks.<system>.sandbox-probe` is the same probe through `mkSandbox`. The script asserts the control is permissive and the sandboxed run is not, then proves the real binary's clean and flagged payloads, comparing stdout, stderr and exit code against the unwrapped binary.
- **Verification:** the script exits `0` for `x86_64-linux`.

### U3. Wire CI and the cache push

- **Goal:** The conformance check is green on both architectures, the macOS package evaluates, and both outputs are pushed on `main`.
- **Requirements:** R6
- **Dependencies:** U2
- **Files:** `.github/workflows/sandbox.yml`, `.github/workflows/ci.yml`, `.github/workflows/nix-cache-push.yml`
- **Approach:** A new `sandbox.yml` runs the conformance on `ubuntu-latest` and `ubuntu-24.04-arm`, lifting the AppArmor restriction first, and evaluates the `aarch64-darwin` package. `ci.yml` builds the unwrapped binary and smokes its version. `nix-cache-push.yml` pushes `comment-checker` and `comment-checker-unwrapped`.
- **Verification:** both conformance jobs green; the cache push run on `main` succeeds.

### U4. Document the default and its Linux prerequisite

- **Goal:** A reader learns the default is sandboxed, what the outputs are, and why an Ubuntu host may need the sysctl.
- **Requirements:** R1, R3
- **Dependencies:** U1
- **Files:** `README.md`
- **Approach:** State the two wrappers and the unwrapped output, the supported systems, and the AppArmor prerequisite with its exact error.
- **Verification:** docs read correctly; no stale claim about `comment-checker-bwrap`.

---

## Verification Contract

| # | Command | Applies | Done signal |
|---|---|---|---|
| 1 | `./scripts/sandbox-conformance.sh x86_64-linux` | U2 | `sandbox conformance: ok (x86_64-linux)` |
| 2 | `nix eval --raw .#packages.aarch64-darwin.comment-checker.drvPath` | U1 | prints a store path |
| 3 | `nix flake check` | U1 | passes |
| 4 | `nix build .#comment-checker .#comment-checker-unwrapped` | U1 | both build |
| 5 | `nix-cache-push` on `main` | U3 | run concludes success; both paths served |

## Definition of Done

- **Global:** R1–R6 hold; the conformance check runs the binary on both Linux architectures and is green; the macOS package evaluates; both outputs are pushed; the README and workflows contain no stale `comment-checker-bwrap` reference.
- **Per-unit:** U1 wrapper shipped and evaluated; U2 probe and script green; U3 workflows updated; U4 docs updated.
