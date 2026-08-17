import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/platform.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  outDir: "dist",
})
