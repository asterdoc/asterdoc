import { createFileRoute } from "@tanstack/react-router";
import { platformApiDocsEnabled } from "@/lib/docs-features";
import { llmsIndex } from "@/lib/llms-index";
import { source } from "@/lib/source";

const index = llmsIndex(source.getPages(), platformApiDocsEnabled);

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
