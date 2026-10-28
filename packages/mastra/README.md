<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=mastra" target="_blank" rel="noopener noreferrer">
    <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
  </a>
</p>

<h1 align="center">@asterdoc/mastra</h1>

[Asterdoc](https://asterdoc.com) is documents as code. This package exposes the shared Asterdoc document operations as native [Mastra](https://mastra.ai) tools.

## Installation

```bash
npm install @asterdoc/mastra @mastra/core zod
```

`@asterdoc/mastra` is verified against `@mastra/core` 1.64.0 and requires Node.js 22.13 or newer, matching Mastra's runtime baseline.

## Use with an agent

```typescript
import { Agent } from "@mastra/core/agent";
import { asterdocTools } from "@asterdoc/mastra";

const agent = new Agent({
  id: "document-agent",
  name: "Document agent",
  instructions: "Use the Asterdoc tools to inspect and complete documents.",
  model: "openai/gpt-4o-mini",
  tools: asterdocTools({
    defaultRegistryUrl: "https://registry.acme.com",
  }),
});
```

The collection keeps the canonical wire names used by `@asterdoc/ai-tools`:

```typescript
const tools = asterdocTools();
tools.get_registry;
tools.get_artifact;
tools.inspect_artifact;
tools.validate_artifact;
tools.validate_input;
tools.fill;
tools.get_fill_state;
tools.update_fill;
tools.render;
tools.extract;
```

Each operation is also available through an individual factory, such as `render()` or `updateFill()`. The factories pass the shared Zod input and output schemas directly to Mastra, and the tool IDs and descriptions remain aligned with the neutral contract.

The same factories are available from per-tool subpaths such as `@asterdoc/mastra/render` and `@asterdoc/mastra/update-fill`.

Mastra's execution `abortSignal` is forwarded to the shared request policy. The raw operation result stays available to application code while `toModelOutput` bounds text and base64 content for the model. Set `maxOutputBytes` to change the default 16 KiB model-facing budget:

```typescript
const tools = asterdocTools({
  defaultRegistryUrl: "https://registry.acme.com",
  maxOutputBytes: 32_000,
});
```

The adapter depends on the framework-neutral `@asterdoc/ai-tools` package and imports Mastra's `createTool` contract. It does not add Mastra dependencies to other Asterdoc adapters or render/session behavior to the shared package.

## Related packages

- [`@asterdoc/ai-tools`](../ai-tools) - framework-neutral tool contract
- [`@asterdoc/ai-sdk`](../ai-sdk) - Vercel AI SDK adapter
- [`@asterdoc/tanstack-ai`](../tanstack-ai) - TanStack AI adapter

## License

MIT. See [LICENSE](./LICENSE).
