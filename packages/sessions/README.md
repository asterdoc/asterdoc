<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=sessions" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/sessions</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=sessions)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

[Asterdoc](https://asterdoc.com?utm_source=github&utm_medium=sessions) is **documents as code**. It lets developers and AI agents define, validate, and render business documents using typed, composable schemas. This eliminates template drift, broken mappings, and brittle glue code, while giving AI systems a reliable document layer they can safely read, reason over, and generate against in production workflows.

## Package overview

The deterministic form-completion session engine for Asterdoc artifacts. An event-sourced command/view core drives a session from an artifact definition: issue a command, append events, project the current view. Its only Asterdoc dependency is `@asterdoc/core`, which keeps it browser-safe by construction.

- 📝 **Event-sourced** - every answer is an appended event; a session rebuilds from its log
- 🔁 **Command and view** - one `Command` mutates, `deriveView` projects the current state for rendering
- 🗄️ **Storage-agnostic** - the engine holds no store; you persist and rehydrate the event log yourself, so in-memory, Redis, and Postgres are all your choice
- 🧭 **Fill-state aware** - reads visibility and required cascades straight from `@asterdoc/core`, so they resolve the same way everywhere
- 🪶 **No LLM, no UI** - an agent or app drives the engine by issuing commands; the engine itself calls no model and renders nothing

## Installation

```bash
npm install @asterdoc/sessions
```

The engine is also re-exported through `@asterdoc/sdk`, so SDK users can import it from there directly.

## Usage

There are three moving parts: a **runtime** that knows the artifact, a **session** that holds the event log, and the **command/view** pair that mutates and reads it.

Build a runtime from an artifact definition. It is the read-only interface the engine uses to look up fields, validate values, and compute fill-state:

```typescript
import { createAsterdocRuntime } from "@asterdoc/sessions";

const runtime = createAsterdocRuntime(artifact);
```

A `Command` is the only way to mutate a session. `execute` decides which events to append and returns a new session plus the events it emitted; it never mutates in place:

```typescript
import { execute } from "@asterdoc/sessions";

const result = execute(
  session,
  runtime,
  { kind: "answer", fieldPath: "age", value: 25, source: "user" },
  { kind: "user" },
);

if (result.ok) {
  session = result.session; // new session with the appended event
} else {
  result.code; // why it was refused
  result.reason;
}
```

A rejection carries no session at all, so the caller simply keeps the one it had. Nothing about the fill changed.

Open a new log with `{ kind: "start" }`. Apply host-supplied values with `{ kind: "prefill", values, lockedPaths }`: each value must name a field and pass its schema, and a locked field then rejects `answer`, `revise`, and `clear`. Values are coerced only when the input has one reading; money never gets an invented currency, dates must be `YYYY-MM-DD`, and a phone number needs a leading `+` unless the runtime is built with `{ defaultCallingCode: "+1" }`.

Project the log into the current view for rendering:

```typescript
import { deriveView } from "@asterdoc/sessions";

const view = deriveView(session, runtime);

view.phase; // where the session is in its lifecycle
view.next; // the field to ask about next, if any
view.nextParty; // the party to ask about next, if any
view.nextAnnex; // the attachment to collect next, if any
view.progress; // answered vs. remaining
```

Only one of `next`, `nextParty`, and `nextAnnex` is non-null at a time. Continue until `view.phase === "ready"`.

Project the log into the artifact's own shape, to fill, render, or seal from what has been answered. Pass the runtime: it says which party roles take an array. The payload is valid part-way through a fill: a field, party, or annex nobody has answered is simply absent.

```typescript
import { sessionPayload } from "@asterdoc/sessions";

const { fields, parties, annexes } = sessionPayload(view.projected, runtime);
```

Because storage is not baked in, you persist and rehydrate the event log yourself. Store the events append-only, in order, and without duplicates; `deriveView` folds the log exactly as given:

```typescript
// Persist the new event log after each command.
await store.save(session.formSessionId, result.session.events);

// Rehydrate later from the stored events.
const session = { ...rest, events: await store.load(id) };
```

For the full API, visit [docs.asterdoc.com](https://docs.asterdoc.com/sdk/sessions).

## Changelog

View the [Changelog](https://github.com/asterdoc/asterdoc/blob/main/CHANGELOG.md) for updates.

## Related packages

- [`@asterdoc/core`](../core) - Runtime, builders, and fill-state; the engine's only Asterdoc dependency
- [`@asterdoc/sdk`](../sdk) - Complete framework; re-exports this engine
- [`@asterdoc/expr`](../expr) - The expression engine behind artifact logic

## Contributing

We're open to all community contributions! If you'd like to contribute in any way, please read our [contribution guidelines](https://github.com/asterdoc/asterdoc/blob/main/CONTRIBUTING.md) and [code of conduct](https://github.com/asterdoc/asterdoc/blob/main/CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT license.

See [LICENSE](https://github.com/asterdoc/asterdoc/blob/main/LICENSE) for more information.
