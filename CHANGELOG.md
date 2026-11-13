# Changelog

## 0.3.7

- Check Nix files: `.nix` maps to the Nix grammar, so comments in a `.nix` edit are reviewed like any other language.
- The Nix grammar is compiled in, so `.nix` files are checked.
- The Claude Code plugin loads again: `hooks/hooks.json` now nests its matchers under `hooks`, the shape Claude Code requires. Before, `claude plugin list` reported "Hook load failed: hooks.json must have 'hooks'" and the plugin checked nothing.
