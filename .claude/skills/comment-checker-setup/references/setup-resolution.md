# Setup resolution: which provider path applies

Decide how the project provisions `comment-checker`, then verify with the doctor.

## The provider paths

| Provider | When it applies | Resolves when | Common failure |
|----------|-----------------|---------------|----------------|
| npm global | Any project; no flake needed | package manager bin dir is on PATH | global bin dir outside PATH (`pnpm bin -g` / `npm bin -g`) |
| direnv + flake | Project has `flake.nix` providing the checker | `.envrc` = `use flake` and `direnv allow` ran | `.envrc` blocked; `direnv allow` never run |
| `nix develop` | Ad-hoc shell entry | the dev shell is active | someone trusts an ambient PATH that is not the shell's |

The hook resolves PATH first, then `direnv exec "$CLAUDE_PROJECT_DIR"`. When PATH misses and no `.envrc` exists, nothing checks the edit — the hook exits 1 with the "did not run" error.

## Path-resolution traps

1. **Ambient direnv state contaminates probes.** A shell that already loaded a dev shell makes `command -v` succeed even when the hook's clean subprocess would miss. Probe with `env -i PATH=/usr/bin:/bin sh -c 'command -v comment-checker'`.
2. **A shadowing binary passes `command -v` but not identity.** The real binary prints `claude-code-comment-checker <semver>` to `--version`. Any other output means a different program owns the name on PATH.
3. **A blocked `.envrc` loads nothing.** `direnv allow` is per-clone state; the doctor's direnv bridge check distinguishes "not installed" from "installed but blocked".

## The one invariant

A hook's resolution must be proven from a clean environment, the same one the hook subprocess runs in — never from the interactive shell you happen to be in.