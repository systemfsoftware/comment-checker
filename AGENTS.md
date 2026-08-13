# AGENTS.md

## Directory map

| Path            | What it holds                    |
| --------------- | -------------------------------- |
| `repos/effect/` | vendored Effect v4rc             |
| `repos/<name>/` | other vendored upstream subtrees |
| `subtrees.toml` | registry of vendored subtrees    |
| `README.md`     | project readme                   |

## Effect version

Effect v4 only. v3 is forbidden — never install, import, or pin `effect@3.*`.

## pnpm toolchain

- **Adding dependencies:** `pnpm add <pkg> --catalog` for anything in the `catalog:` block of `pnpm-workspace.yaml`. `catalogMode: strict` rejects a bare `pnpm add <catalogued-pkg>`; `--frozen-lockfile` in CI catches violations.
- **Lockfiles:** `gitBranchLockfile: true` — installs on non-master branches write `pnpm-lock.<branch>.yaml` and never touch `pnpm-lock.yaml`. Do not gitignore branch lockfiles; push to master reconciles them.
- **Formatting:** `./bin/dprint fmt` (never a bare `dprint` command — the native binary is a platform package resolved by the wrapper).
- **Linting:** `pnpm run lint` (oxlint).

## Commits

Commits follow Conventional Commits. Subject is imperative, ≤72 chars, no trailing period; case is free (identifiers like `WordPart` are fine). Body explains what, why, and the verification evidence (cite the test/gate run). Add `Refs: #issue` when grounded in a spec/issue. Never add `Co-Authored-By` for yourself or any AI. The type must match what you touched: docs-only → `docs`; `feat`/`fix` must touch production source.
