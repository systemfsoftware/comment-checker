import { execFileSync } from "node:child_process";

import type { UserConfig } from "@commitlint/types";

// Drop-in commitlint config for agent-authored repos.
// See references/commitlint-rules.md and references/commitlint-plugins.md.

const isDoc = (p: string) => /\.mdx?$/.test(p) || /^docs\//.test(p) || /(^|\/)README\.md$/i.test(p);
const isTest = (p: string) =>
  /\.(test|spec|tst)\.[tj]sx?$/.test(p) || /(^|\/)(__tests__|tests?|e2e|fixtures)\//.test(p);
const isCI = (p: string) => /^\.github\/(workflows|actions)\//.test(p);
const isLock = (p: string) =>
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|bun\.lockb?|yarn\.lock)$/.test(p);
const isTool = (p: string) =>
  /^(\.claude|\.husky|\.opencode)\//.test(p)
  || /(^|\/)(commitlint\.config\.[mc]?[jt]s|tsconfig.*\.json|vitest\.config\.[mc]?[jt]s|oxlint\.config\.[mc]?[jt]s|turbo\.json|package\.json)$/
    .test(p);
const isProduction = (p: string) => !isDoc(p) && !isTest(p) && !isCI(p) && !isLock(p) && !isTool(p);

const SHAPES = [
  { name: "docs-only", match: isDoc, allowed: new Set(["docs", "fix", "refactor"]) },
  { name: "test-only", match: isTest, allowed: new Set(["test", "fix", "refactor"]) },
  { name: "ci-only", match: isCI, allowed: new Set(["ci", "chore"]) },
  { name: "lockfile", match: isLock, allowed: new Set(["deps", "chore", "build"]) },
  { name: "tooling", match: isTool, allowed: new Set(["chore", "build", "ci", "refactor"]) },
] as const;

// In a GitButler workspace, source files from `but diff` instead of git diff --cached.
const stagedFiles = (): readonly string[] => {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      encoding: "utf8",
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

const configuration: UserConfig = {
  extends: ["@commitlint/config-conventional"],

  plugins: [
    {
      rules: {
        "no-ai-coauthors": ({ raw }) => {
          if (!raw) return [true, "OK"];
          const aiEmailPatterns = [
            /noreply@anthropic\.com/i,
            /cursoragent@cursor\.com/i,
            /noreply@aider\.dev/i,
            /cascade@windsurf\.com/i,
            /noreply@codeium\.com/i,
            /factory-droid\[bot\]@users\.noreply\.github\.com/i,
          ] as const;
          const coauthorLines = raw.match(/^Co-?-?[Aa]uthored-by:.*$/gmi) || [];
          const aiModelPatterns = [
            /\b(Claude\s+)?(Opus|Sonnet|Haiku)\b/i,
            /\bgpt-4o\b/i,
            /\bClaude\b.*\b\d+\.\d+\b/i,
          ] as const;
          const hasAIModelInCoauthor = coauthorLines.some((line: string) =>
            aiModelPatterns.some((p) => p.test(line))
          );
          const hasAIEmail = aiEmailPatterns.some((p) => p.test(raw));
          const hasAICoauthor = hasAIEmail || hasAIModelInCoauthor;
          return [
            !hasAICoauthor,
            hasAICoauthor
              ? "AI co-authors and AI model references are not allowed in commit messages"
              : "OK",
          ];
        },
        "type-matches-diff-shape": ({ type }) => {
          const files = stagedFiles();
          if (files.length === 0 || !type) return [true, "OK"];
          const allMatch = (m: (p: string) => boolean) => files.every(m);
          for (const s of SHAPES) {
            if (allMatch(s.match) && !s.allowed.has(type)) {
              return [
                false,
                `'${type}' with 100% ${s.name} paths — REQUIRED type: ${
                  [...s.allowed].sort().join(" / ")
                }`,
              ];
            }
          }
          if ((type === "feat" || type === "fix") && !files.some(isProduction)) {
            return [
              false,
              `'${type}' MUST touch >=1 production source file (not only docs/test/ci/lockfile/tooling)`,
            ];
          }
          return [true, "OK"];
        },
      },
    },
  ],

  rules: {
    "no-ai-coauthors": [2, "always"],
    "type-matches-diff-shape": [2, "always"],

    "type-enum": [
      2,
      "always",
      [
        "ai",
        "api",
        "build",
        "chore",
        "ci",
        "deps",
        "docs",
        "feat",
        "fix",
        "improvement",
        "perf",
        "refactor",
        "revert",
        "security",
        "style",
        "test",
      ],
    ],
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
    "scope-empty": [2, "always"],

    // Conventional Commits §15: case-insensitive. Disabled for agent-authored commits.
    "subject-case": [0],
    "header-case": [0],
    "body-case": [0],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],

    "header-max-length": [2, "always", 72],
    "body-max-line-length": [2, "always", 120],
    "footer-max-line-length": [2, "always", 100],

    "body-leading-blank": [2, "always"],
    "footer-leading-blank": [2, "always"],
    "header-full-stop": [2, "never", "."],
    "body-full-stop": [2, "never", "."],

    "references-empty": [1, "never"],
  },

  defaultIgnores: true,
  formatter: "@commitlint/format",
};

export default configuration;
