# comment-checker

[![CI](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/systemfsoftware/comment-checker/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Coding agents tend to write comments that restate the code next to them: `// increment counter` above `counter += 1;`. `comment-checker` is a `PostToolUse` hook for Claude Code that runs after every `Write`, `Edit` or `MultiEdit`, flags those comments, and sends the reason back to the model so it can delete them.

It is a single native binary built on tree-sitter. It parses 37 languages, keeps comments that carry a reason (licence headers, linter directives, `@param` docs, `// Workaround for ...`), and never calls a model or the network.

## What it flags

```bash
$ echo '{"tool_name":"Write","tool_input":{"file_path":"src/math.ts","content":"// increment counter\ncounter += 1;\n"}}' | comment-checker
An automated reviewer flagged 1 comment(s) in src/math.ts as unnecessary.

Each is stated with the specific reason it should be removed. Do not
dismiss these as "justified" — the reason is given so the claim can be
checked, not argued away.

  line 1 — // increment counter — restates what the code already says (shares counter; increment ↔ +=)

Action: delete the flagged comments. If the code is unclear without
one, make the code self-explanatory instead — better names, extraction,
a clearer type — and do not re-add the comment.
```

The exit code is `2` in that case. Clean input prints `[check-comments] Skipping: No unnecessary comments found` and exits `0`.

| Class | Flagged example |
|---|---|
| Restatement | `// increment counter` above `counter += 1;` |
| Control-flow narration | `// loop through items` above `for item in items:` |
| Changelog memo | `// Changed from old_api to new_api` |
| Dead code | `// console.log("debug", value);` |
| Untracked TODO | `// TODO: fix this later` |

It keeps comments that carry a reason or a tool directive: licence headers and SPDX tags, linter directives such as `# noqa` and `// @ts-ignore`, structured API docs such as `@param`, `@returns`, `Args:` and `# Safety`, BDD annotations such as `// Given`, and rationale such as `// Workaround for upstream race in connection pool`.

Verdicts that depend on surrounding code never convict a fragment. On `Edit` and `MultiEdit`, only comments the edit introduces are checked.

## Install

The package is not published to npm. Take the binary from this repository's Nix flake, which is built at each release tag. The flake provides `packages.default`, a wrapper that runs the binary under `bubblewrap` with no network access.

```bash
nix profile install github:systemfsoftware/comment-checker \
  --option extra-substituters https://nix.systemfsoftware.com \
  --option extra-trusted-public-keys 'nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M='
comment-checker --version
```

In a flake of your own, add the input and reuse its package:

```nix
{
  nixConfig = {
    extra-substituters = [ "https://nix.systemfsoftware.com" ];
    extra-trusted-public-keys = [ "nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M=" ];
  };
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    comment-checker.url = "github:systemfsoftware/comment-checker";
  };
  outputs = { nixpkgs, comment-checker, ... }: {
    devShells.x86_64-linux.default = nixpkgs.legacyPackages.x86_64-linux.mkShell {
      packages = [ comment-checker.packages.x86_64-linux.default ];
    };
  };
}
```

Supported systems are `x86_64-linux` and `aarch64-linux`.

## Configure Claude Code

Add the hook to `.claude/settings.json` in a project, or to `~/.claude/settings.json` for every project:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "comment-checker" }
        ]
      }
    ]
  }
}
```

Claude Code treats exit `2` as a block and passes stderr back to the model. Any other non-zero exit, including `127` when the binary is missing from `PATH`, does not block the write, so confirm the binary resolves with `command -v comment-checker` from the directory where Claude Code runs.

### Options

- `--prompt "<text>"` replaces the warning wrapper. `{{comments}}` marks where the report goes.
- `--strip` deletes flagged whole-line comments from the file named in the payload. Trailing and inline comments are reported, not removed. The hook does not use this flag; it is for manual clean-up.

```bash
comment-checker --strip < payload.json
```

## Exit codes

| Code | Meaning | Stream |
|---|---|---|
| `0` | Clean, or the payload could not be parsed (fails open) | stdout |
| `2` | Unnecessary comments flagged | stderr |

The binary never modifies a file unless `--strip` is given.

## Support

Issues and questions go to [GitHub Issues](https://github.com/systemfsoftware/comment-checker/issues).

## Contributing

Development setup, checks and the release process are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
