import { createFileRoute } from "@tanstack/react-router";
import { MCP_URL } from "@asterdoc/agent-discovery";
import { pageMarkdownUrl } from "@/lib/page-actions";
import { source } from "@/lib/source";

const index = [
  "# Asterdoc documentation",
  "",
  ...source.getPages().flatMap((page) => [
    `- [${page.data.title}](https://docs.asterdoc.com${pageMarkdownUrl(page.url)}): ${page.data.description ?? ""}`,
  ]),
  "",
  "## Agent resources",
  "",
  "- [Agent Skills index](https://docs.asterdoc.com/.well-known/agent-skills/index.json): the asterdoc and asterdoc-react skills, with digests",
  "- [API catalog](https://docs.asterdoc.com/.well-known/api-catalog): the hosted services",
  `- [MCP server card](https://docs.asterdoc.com/.well-known/mcp/server-card.json): how to connect to ${MCP_URL}`,
].join("\n");

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(index, {
          headers: {
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
    },
  },
});
