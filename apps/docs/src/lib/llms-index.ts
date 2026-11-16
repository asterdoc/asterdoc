import {
  API_CATALOG_PATH,
  DOCS_ORIGIN,
  MCP_URL,
  SERVER_CARD_PATH,
  SKILLS_INDEX_PATH,
} from "@asterdoc/agent-discovery";
import { pageMarkdownUrl } from "@/lib/page-actions";

interface IndexPage {
  url: string;
  data: { title: string; description?: string };
}

export function llmsIndex(pages: readonly IndexPage[], platformApi: boolean): string {
  return [
    "# Asterdoc documentation",
    "",
    ...pages.map(
      (page) =>
        `- [${page.data.title}](${DOCS_ORIGIN}${pageMarkdownUrl(page.url)}): ${page.data.description ?? ""}`,
    ),
    "",
    "## Agent resources",
    "",
    `- [Agent Skills index](${DOCS_ORIGIN}${SKILLS_INDEX_PATH}): the public Asterdoc skills, with digests`,
    ...(platformApi
      ? [
          `- [API catalog](${DOCS_ORIGIN}${API_CATALOG_PATH}): the hosted services`,
          `- [MCP server card](${DOCS_ORIGIN}${SERVER_CARD_PATH}): how to connect to ${MCP_URL}`,
        ]
      : []),
  ].join("\n");
}
