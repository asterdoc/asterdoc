<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=tanstack-ai" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/tanstack-ai</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=tanstack-ai)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

Experimental [TanStack AI](https://tanstack.com/ai) tools for Asterdoc document workflows. The adapter is tested against TanStack AI `0.53.0` and remains experimental until TanStack AI reaches a stable release. TanStack AI's pre-1.0 API may change between releases.

The adapter consumes the canonical schemas, descriptions, result contracts, and execution functions from `@asterdoc/ai-tools`.

## Installation

```bash
npm install @asterdoc/tanstack-ai@0.9.0 @tanstack/ai@0.53.0 @tanstack/ai-openai@0.22.5 zod
```

## Native server tools

`asterdocTools()` returns a readonly ten-tool tuple that can be passed directly to TanStack AI's `chat` activity:

```typescript
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { asterdocTools } from "@asterdoc/tanstack-ai";

const result = await chat({
  adapter: openaiText("gpt-5.5"),
  messages: [{ role: "user", content: "Inspect the purchase agreement fields." }],
  tools: asterdocTools({
    defaultRegistryUrl: "https://registry.acme.com",
  }),
  stream: false,
});
```

The collection contains these canonical wire names:

| Tool | Purpose |
| --- | --- |
| `get_registry` | Discover artifacts in a registry |
| `get_artifact` | Retrieve an artifact and its instructions |
| `inspect_artifact` | Return a bounded artifact description |
| `validate_artifact` | Validate an artifact definition |
| `validate_input` | Validate one field, party, annex, or checklist item |
| `fill` | Seed a form or checklist draft |
| `get_fill_state` | Inspect draft progress and the next target |
| `update_fill` | Merge, clear, or reset a draft |
| `render` | Render a form, document, or checklist |
| `extract` | Read a filled PDF form back into form data |

Each tool uses the shared Zod input and output schemas. TanStack AI validates tool input before calling the server function and validates output through `outputSchema`, so application code retains the inferred result type.

## Definition-only composition

Use `asterdocToolDefinitions()` when a client needs tool metadata and schemas without server credentials or execution functions. Instantiate a definition with TanStack AI's native `.client()` or `.server()` method at the boundary that owns execution:

```typescript
import { asterdocToolDefinitions } from "@asterdoc/tanstack-ai";

const definitions = asterdocToolDefinitions();
const clientTools = definitions.map((definition) => definition.client());
```

Individual server factories and definition functions are available from the root and from package subpaths, such as `getFillState()` and `@asterdoc/tanstack-ai/get-fill-state`.

## Cancellation and configuration

TanStack AI's execution `abortSignal` is composed with `AsterdocToolsConfig.signal` and the request context signal before the shared operation runs. Registry, artifact, instruction, and layer requests observe the resulting signal.

```typescript
const tools = asterdocTools({
  defaultRegistryUrl: "https://registry.acme.com",
  approvedOrigins: ["https://registry.acme.com"],
  maxOutputBytes: 200_000,
});
```

`maxOutputBytes` bounds content sent to the model while leaving the application result complete. It defaults to 16,384 bytes. An explicit `presentation` input independently controls the application-facing render result.

## Related packages

- [`@asterdoc/ai-tools`](../ai-tools) provides the framework-neutral contract.
- [`@asterdoc/ai-sdk`](../ai-sdk) provides the Vercel AI SDK 7 adapter.
- [`@asterdoc/mastra`](../mastra) provides the Mastra adapter.

## License

MIT
