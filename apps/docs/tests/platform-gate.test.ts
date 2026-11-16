import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createProcessor } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { describe, expect, test } from "vitest";

import { createDocsEntry } from "@/lib/docs-entry";
import { PLATFORM_API_PAGES, remarkPlatformOnly } from "@/lib/docs-features";
import { llmsIndex } from "@/lib/llms-index";

const CONTENT_DIR = path.resolve(__dirname, "../content/docs");
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const PLATFORM_TEXT =
  /\bMCP\b|mcp\.asterdoc\.com|api\.asterdoc\.com|Platform API|x-api-key|hostedSealAdapter|api-catalog|server-card/i;
const GATED_SLUGS = PLATFORM_API_PAGES.map((page) => `/${page.replace(/\.mdx$/, "")}`);

function ungatedPages(): string[] {
  return readdirSync(CONTENT_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !PLATFORM_API_PAGES.includes(file as (typeof PLATFORM_API_PAGES)[number]))
    .filter((file) => !file.startsWith("changelog/"))
    .sort();
}

interface Node {
  type: string;
  name?: string | null;
  value?: string;
  url?: string;
  children?: Node[];
}

function parse(source: string): Node {
  return createProcessor({ remarkPlugins: [remarkGfm] }).parse(source) as Node;
}

function gated(source: string, enabled: boolean): Node {
  const tree = parse(source);
  remarkPlatformOnly({ enabled })(tree);
  return tree;
}

function content(tree: Node): string {
  return JSON.stringify(tree, (key, value) => (key === "position" ? undefined : value));
}

function page(file: string, enabled: boolean): { frontmatter: string; body: string } {
  const source = readFileSync(path.join(CONTENT_DIR, file), "utf8");
  return {
    frontmatter: FRONTMATTER.exec(source)?.[1] ?? "",
    body: content(gated(source.replace(FRONTMATTER, ""), enabled)),
  };
}

function links(body: string): string[] {
  return [...body.matchAll(/"url":"([^"]*)"/g)].map(([, url]) => url!);
}

describe("remarkPlatformOnly", () => {
  const source = [
    "Intro.",
    "",
    "<PlatformOnly>",
    "",
    "## Hosted",
    "",
    "Hosted text.",
    "",
    "</PlatformOnly>",
    "",
    "Local<PlatformOnly> and hosted</PlatformOnly> only.",
  ].join("\n");

  test("drops each block and its content when the platform docs are off", () => {
    const body = content(gated(source, false));
    expect(body).toContain("Intro.");
    expect(body).toContain("Local");
    expect(body).not.toMatch(/hosted|Hosted|PlatformOnly/);
  });

  test("keeps the content without the wrapper when the platform docs are on", () => {
    const tree = gated(source, true);
    const body = content(tree);
    expect(body).toContain("Hosted text.");
    expect(body).toContain(" and hosted");
    expect(body).not.toContain("PlatformOnly");
    expect(tree.children?.map((node) => node.type)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
      "paragraph",
    ]);
  });

  test("is wired into the docs build with the platform flag", () => {
    const config = readFileSync(path.resolve(__dirname, "../source.config.ts"), "utf8");
    expect(config).toMatch(
      /const platformApiDocs = process\.env\.ASTERDOC_DOCS_PLATFORM_API === "true"/,
    );
    expect(config).toMatch(/\[remarkPlatformOnly, \{ enabled: platformApiDocs \}\]/);
  });
});

describe("public docs pages with the platform docs off", () => {
  test("cover the hand-written pages", () => {
    expect(ungatedPages()).toEqual(expect.arrayContaining(["ai/skills/index.mdx", "guides/index.mdx"]));
    expect(ungatedPages().length).toBeGreaterThan(50);
  });

  test.each(ungatedPages())("%s says nothing about the unreleased Platform", (file) => {
    const { frontmatter, body } = page(file, false);
    expect(frontmatter).not.toMatch(PLATFORM_TEXT);
    expect(body.match(PLATFORM_TEXT)).toBeNull();
    expect(links(body).filter((url) => GATED_SLUGS.some((slug) => url.startsWith(slug)))).toEqual([]);
  });
});

describe("public docs pages with the platform docs on", () => {
  test("the skills page pairs the skills with the hosted MCP server", () => {
    const { body } = page("ai/skills/index.mdx", true);
    expect(body).toContain("Pairing with MCP");
    expect(body).toContain("hosted MCP server");
  });

  test("the guides overview links every platform guide", () => {
    const urls = links(page("guides/index.mdx", true).body);
    for (const slug of GATED_SLUGS) expect(urls).toContain(slug);
  });

  test("the SDK and sealing pages name the hosted seal adapter", () => {
    expect(page("(reference)/sdk/index.mdx", true).body).toContain("hostedSealAdapter");
    expect(page("guides/sealing-and-conversion.mdx", true).body).toContain("hostedSealAdapter");
  });
});

describe("llms.txt", () => {
  const pages = [{ url: "/concepts", data: { title: "Concepts", description: "The model" } }];

  test("lists the pages and the skills index, and no Platform resource, when the platform docs are off", () => {
    const index = llmsIndex(pages, false);
    expect(index).toContain("- [Concepts](https://docs.asterdoc.com/concepts.md): The model");
    expect(index).toContain("https://docs.asterdoc.com/.well-known/agent-skills/index.json");
    expect(index).not.toMatch(PLATFORM_TEXT);
  });

  test("lists the API catalog and the MCP server card when the platform docs are on", () => {
    const index = llmsIndex(pages, true);
    expect(index).toContain("- [API catalog](https://docs.asterdoc.com/.well-known/api-catalog)");
    expect(index).toContain(
      "- [MCP server card](https://docs.asterdoc.com/.well-known/mcp/server-card.json): how to connect to https://mcp.asterdoc.com/mcp",
    );
  });
});

describe("docs entry", () => {
  const docs = async (request: Request) =>
    new URL(request.url).pathname === "/"
      ? new Response("<html>home")
      : new Response("Not found.\n", { status: 404 });
  const get = (platformApi: boolean, pathname: string) =>
    createDocsEntry({ platformApi, docs })(
      new Request(`https://docs.asterdoc.com${pathname}`, { headers: { Accept: "application/json" } }),
    );

  test("serves no Platform discovery document and links no catalog when the platform docs are off", async () => {
    expect((await get(false, "/.well-known/api-catalog")).status).toBe(404);
    expect((await get(false, "/.well-known/mcp/server-card.json")).status).toBe(404);
    const home = await get(false, "/");
    expect(home.headers.get("Link")).toContain('title="Agent Skills index"');
    expect(home.headers.get("Link")).not.toContain("api-catalog");
  });

  test("serves the API catalog and the server card, and links the catalog, when the platform docs are on", async () => {
    const catalog = await get(true, "/.well-known/api-catalog");
    expect(catalog.status).toBe(200);
    expect(await catalog.text()).toContain("https://api.asterdoc.com/v1");
    const card = await get(true, "/.well-known/mcp/server-card.json");
    expect(card.status).toBe(200);
    expect(await card.text()).toContain("https://mcp.asterdoc.com/mcp");
    expect((await get(true, "/")).headers.get("Link")).toContain('rel="api-catalog"');
  });
});
