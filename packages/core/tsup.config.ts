import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"], // ESM only - saves ~1.6MB by removing CJS bundle
  dts: {
    resolve: true,
    // Skip DTS for now - types are still generated but may have errors
    // The runtime code works fine, types are for development only
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  preserveImportMeta: true, // Preserve JSON import attributes
  define: {
    __ASTERDOC_CORE_VERSION__: JSON.stringify(packageJson.version),
  },
  external: [
    // Mark workspace dependencies as external (they'll be installed separately)
    "@asterdoc/expr",
    "@asterdoc/schemas", // Schema JSON is imported directly from package root
    "@asterdoc/types",
    // Mark runtime dependencies as external (they're in package.json dependencies)
    "zod",
    "yaml",
    "@standard-schema/spec",
  ],
});
