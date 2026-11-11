# Contributing

## Development setup

The repository's Nix flake provides the dev shell, including the pinned Rust toolchain, `cargo-mutants`, `bubblewrap`, Node.js and pnpm.

```bash
nix develop
```

The shell builds the `comment-checker` wrapper on `PATH`, so the hook can be exercised locally.

## Checks

Run the Rust gates before opening a pull request:

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets
```

Changes to the classifier in `crates/comment-checker/src/classify.rs` also need the mutation gate:

```bash
pnpm mutants
```

The JavaScript launcher in `npm/packages/comment-checker` is checked with:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build && pnpm typecheck
```

The hook runner in `hooks/run.ts` is checked with `deno cache --frozen --config hooks/deno.jsonc hooks/run.ts`.

## Classifier evaluation

`eval/corpus.json` holds the 60-case multi-language classification corpus. `crates/comment-checker/tests/f1.rs` enforces the F1 floor against it.

## Layout

| Path | Contents |
|---|---|
| `crates/comment-checker` | Rust library and the `comment-checker` binary: parsing, classification, hook payload handling, `--strip` |
| `npm/packages/comment-checker` | npm launcher, not published (see the note in the README) |
| `hooks/` | Deno hook runner for the Claude Code plugin |
| `.claude/skills/comment-checker-setup` | Setup skill and a diagnostic script |
| `eval/` | Classification corpus |
| `docs/` | Plans and solution notes |

## Releases

Releases run through the shared toolchain in [systemfsoftware/pnpm-release-management](https://github.com/systemfsoftware/pnpm-release-management):

1. A pull request adds a `.changeset` intent.
2. On merge to `master`, the toolchain opens a release pull request.
3. Merging that pull request tags the version and creates its GitHub Release.

`release.jsonc` configures the toolchain. It updates the version in `Cargo.toml`, the launcher `package.json`, `flake.nix` and `.claude-plugin/plugin.json`.

Nothing goes to npm. `@systemfsoftware` packages are published to `nix.systemfsoftware.com`: producers push tarballs there from `main`, and consumers substitute them through flake inputs. This repository's flake is built at each tag.
