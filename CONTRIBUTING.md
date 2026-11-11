# Contributing

See [AGENTS.md](AGENTS.md) for development rules, branch discipline, and verification gates.

Releases run through the shared toolchain
([systemfsoftware/pnpm-release-management](https://github.com/systemfsoftware/pnpm-release-management)):
a `.changeset` intent on a pull request, then on merge the toolchain opens a
release PR, and merging that tags the version and cuts its GitHub Release.
`release.jsonc` configures it. nix.systemfsoftware.com is the package registry for `@systemfsoftware` packages: producers push package tarballs there from `main`, consumers substitute them through flake inputs, and nothing goes to npm. This repository's Nix flake is built at the
tag.
