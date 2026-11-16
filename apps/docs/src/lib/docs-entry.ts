import {
  DOCS_ORIGIN,
  handleDiscoveryRequest,
  withHomepageLinks,
} from "@asterdoc/agent-discovery";
import { redirectMovedPage } from "@/lib/moved-pages";

export function createDocsEntry(options: {
  platformApi: boolean;
  docs: (request: Request) => Promise<Response>;
}): (request: Request) => Promise<Response> {
  return async (request) =>
    (options.platformApi ? handleDiscoveryRequest(request, DOCS_ORIGIN) : null) ??
    redirectMovedPage(request) ??
    withHomepageLinks(
      request,
      await options.docs(request),
      { href: "/llms.txt", type: "text/plain" },
      { apiCatalog: options.platformApi },
    );
}
