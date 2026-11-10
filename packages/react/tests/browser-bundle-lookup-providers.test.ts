import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, sep } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const componentsRoot = resolve(packageRoot, "../components");
const builtOutput = resolve(packageRoot, "dist");
const builtEntry = resolve(builtOutput, "index.js");
const fromBuiltOutput = (path: string) => path.startsWith(builtOutput + sep);
const fromSource = (path: string) => path.startsWith(resolve(packageRoot, "src") + sep);
const requireFromPackage = createRequire(resolve(packageRoot, "package.json"));
const providerEntries = [
  requireFromPackage.resolve("@asterdoc/format/phone"),
  requireFromPackage.resolve("@asterdoc/format/regions"),
];

function isLookupProviderModule(path: string): boolean {
  return providerEntries.includes(path) || /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:libphonenumber-js|cldr-[^\\/]+)[\\/]/u.test(path);
}

async function browserBundleModules(contents: string, from = packageRoot): Promise<string[]> {
  const result = await build({
    stdin: { contents, resolveDir: from, loader: "ts" },
    absWorkingDir: from,
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    outfile: "bundle.js",
    write: false,
    metafile: true,
    logLevel: "silent",
    external: ["react", "react-dom", "react/*", "react-dom/*", "pdfjs-dist", "pdfjs-dist/*"],
  });
  return Object.values(result.metafile.outputs)
    .flatMap((output) => Object.entries(output.inputs))
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => resolve(from, path));
}

async function providerModulesInBrowserBundle(contents: string, from?: string): Promise<string[]> {
  return (await browserBundleModules(contents, from)).filter(isLookupProviderModule);
}

describe("a browser bundle of @asterdoc/react", () => {
  it("from source carries neither the phone provider nor the regions data", async () => {
    expect(await providerModulesInBrowserBundle('export * from "./src/index.ts";')).toEqual([]);
  }, 30_000);

  it("through its package exports, from the built output, carries neither", async () => {
    expect(existsSync(builtEntry), "build @asterdoc/react before this test").toBe(true);
    const modules = await browserBundleModules('export * from "@asterdoc/react";', componentsRoot);
    expect(modules.some(fromBuiltOutput)).toBe(true);
    expect(modules.some(fromSource)).toBe(false);
    expect(modules.filter(isLookupProviderModule)).toEqual([]);
  }, 30_000);

  it("is caught when an import pulls libphonenumber-js and the CLDR regions into it", async () => {
    const found = await providerModulesInBrowserBundle(
      'export * from "./src/index.ts"; export { phoneProvider } from "@asterdoc/format/phone"; export { regionsProvider } from "@asterdoc/format/regions";',
    );
    expect(found).toEqual(expect.arrayContaining([...providerEntries, expect.stringMatching(/libphonenumber-js/u)]));
  }, 30_000);
});

describe("a browser bundle of @asterdoc/components", () => {
  it("through its package exports carries neither, and reaches @asterdoc/react's built output", async () => {
    const modules = await browserBundleModules('export * from "@asterdoc/components";', componentsRoot);
    expect(modules.some(fromBuiltOutput)).toBe(true);
    expect(modules.some((path) => path.startsWith(resolve(componentsRoot, "src") + sep))).toBe(true);
    expect(modules.filter(isLookupProviderModule)).toEqual([]);
  }, 30_000);
});
