import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/discovery/index.ts",
  ],
  format: ["esm"],
  dts: {
    resolve: true,
  },
  // Splitting keeps the modules both entries import in one shared chunk.
  splitting: true,
  sourcemap: false,
  clean: true,
  external: [
    "@asterdoc/core",
    "@asterdoc/render",
    "@asterdoc/format",
    "@asterdoc/types",
    "react",
    "react-dom",
  ],
});
