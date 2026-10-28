# @asterdoc/ai-sdk

Native [AI SDK 7](https://ai-sdk.dev/) tools for Asterdoc document workflows. The adapter consumes the canonical schemas, descriptions, result contracts, and execution functions from `@asterdoc/ai-tools`.

The package is verified with AI SDK `7.0.94`, Zod `4.1.8` or newer in the v4 line, and Node.js `22` or newer.

## Installation

```bash
npm install @asterdoc/ai-sdk ai zod @ai-sdk/openai
```

## Use the native tool map

`asterdocTools()` returns all ten operations under their canonical snake_case names so the map can be passed directly to `generateText`, `streamText`, or an AI SDK agent.

```typescript
import { generateText, isStepCount } from "ai";
import { openai } from "@ai-sdk/openai";
import { asterdocTools } from "@asterdoc/ai-sdk";

const result = await generateText({
  model: openai("gpt-4o"),
  tools: asterdocTools({
    defaultRegistryUrl: "https://registry.acme.com",
  }),
  stopWhen: isStepCount(10),
  prompt: "Find the pet-addendum artifact and list its required fields.",
});
```

`generateText` and `streamText` stop after one step unless `stopWhen` is set. Without it, the model calls one tool and stops.

The collection keys and tool IDs are:

| Tool | Purpose |
| --- | --- |
| `get_registry` | Discover artifacts in a registry |
| `get_artifact` | Retrieve an artifact and selected instructions |
| `inspect_artifact` | Return a bounded, selectable artifact description |
| `validate_artifact` | Validate an artifact definition |
| `validate_input` | Validate one field, party, annex, or checklist item |
| `fill` | Seed a form or checklist draft |
| `get_fill_state` | Inspect progress and the next available target |
| `update_fill` | Merge, clear, or reset a draft |
| `render` | Render a form, document, or checklist |
| `extract` | Read a filled PDF form back into form data |

## Use one tool

Each operation is available as a named factory and as a package subpath. Subpaths let an application select one operation without constructing the complete collection.

```typescript
import getFillState from "@asterdoc/ai-sdk/get-fill-state";

const fillState = getFillState({
  defaultRegistryUrl: "https://registry.acme.com",
});
```

The root named factories are `getRegistry`, `getArtifact`, `inspectArtifact`, `validateArtifact`, `validateInput`, `fill`, `getFillState`, `updateFill`, `render`, and `extract`.

## Canonical inputs and results

Tool inputs use the shared `snake_case` wire contract. Source-backed operations accept one of these forms:

```typescript
const source = { source: "artifact", artifact };
const remoteSource = { source: "url", url: "https://example.com/artifact.json" };
const registrySource = {
  source: "registry",
  registry_url: "https://registry.acme.com",
  artifact_name: "purchase-agreement",
};
```

The adapter passes the shared Zod schemas directly to AI SDK 7. AI SDK validates model-generated calls before execution, and the adapter does not parse the input a second time. Result types and `outputSchema` are also shared, so application code receives the complete canonical result returned by `@asterdoc/ai-tools`.

## Cancellation and output limits

The AI SDK `abortSignal` is composed with `AsterdocToolsConfig.signal` and passed into a request-scoped neutral execution context. Registry, artifact, instruction, and layer requests observe the combined signal.

`maxOutputBytes` bounds content sent back to the model while keeping the application result complete. Render presentation can separately request a smaller application result:

```typescript
const tools = asterdocTools({ maxOutputBytes: 200_000 });

const renderResult = await tools.render.execute({
  source: "artifact",
  artifact,
  presentation: { max_bytes: 20_000, include_content: true },
}, {
  toolCallId: "render-1",
  messages: [],
  context: {},
});
```

The model-facing limit defaults to 16,384 bytes. An explicit `presentation` input controls the application-facing render result independently.

## Related packages

- [`@asterdoc/ai-tools`](../ai-tools) provides the framework-neutral contracts and execution functions.
- [`@asterdoc/mastra`](../mastra) provides the Mastra adapter.
- [`@asterdoc/tanstack-ai`](../tanstack-ai) provides the TanStack AI adapter.
- [`@asterdoc/sdk`](../sdk) provides the Asterdoc framework SDK.

## License

MIT
