import { defineConfig } from "tsdown"

export default defineConfig({
  tsconfig: "./tsconfig.json",
  entry: ["src/index.ts", "src/platform.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  outDir: "dist",
})
