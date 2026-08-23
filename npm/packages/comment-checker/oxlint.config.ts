import { defineConfig } from "oxlint"

// `plugins` REPLACES oxlint's default plugin set rather than merging into it,
// so every plugin that should contribute rules must be listed explicitly.
// Omitting `oxc` (or `unicorn`) silently drops their whole rule families while
// `correctness` still looks enabled.
export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "warn",
  },
  ignorePatterns: ["node_modules/**", "dist/**", "dist-types/**"],
})