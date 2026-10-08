# Contributing

See [AGENTS.md](AGENTS.md) for development rules, branch discipline, and verification gates.

Releases run through the shared toolchain
([systemfsoftware/pnpm-release-management](https://github.com/systemfsoftware/pnpm-release-management)):
a `.changeset` intent on a pull request, then on merge the toolchain opens a
release PR, and merging that tags the version and cuts its GitHub Release.
`release.jsonc` configures it. Distribution is this repository's Nix flake at
the tag — nothing is published to a registry.
