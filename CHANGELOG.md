# Changelog

## 0.3.7

- The Claude Code plugin loads again: `hooks/hooks.json` now nests its matchers under `hooks`, the shape Claude Code requires. Before, `claude plugin list` reported "Hook load failed: hooks.json must have 'hooks'" and the plugin checked nothing.
