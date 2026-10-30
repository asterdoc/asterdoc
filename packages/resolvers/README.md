<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=resolvers" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/resolvers</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=resolvers)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

[Asterdoc](https://asterdoc.com?utm_source=github&utm_medium=resolvers) is **documents as code**. It lets developers and AI agents define, validate, and render business documents using typed, composable schemas. This eliminates template drift, broken mappings, and brittle glue code — while giving AI systems a reliable document layer they can safely read, reason over, and generate against in production workflows.

## Package overview

Environment-specific resolvers for Asterdoc. Use these to read layer files, templates, and other assets in your Asterdoc applications.

- 📂 **Filesystem resolver** - Read root-confined local files in Node.js
- 🌐 **HTTP resolver** - Read files beneath a base URL in any runtime with `fetch`
- 🧠 **Memory resolver** - Read exact-key text and bytes in any JavaScript environment
- ✅ **Type-safe** - Full TypeScript support
- 🔌 **Pluggable** - Implements the `Resolver` interface from `@asterdoc/types`

## Installation

```bash
npm install @asterdoc/resolvers
```

## Usage

### Filesystem resolver

Create a resolver to read files from your filesystem:

```typescript
import { createFsResolver } from "@asterdoc/resolvers/fs";

const resolver = createFsResolver({ root: process.cwd() });

// Read a file relative to root
const bytes = await resolver.read("/templates/form.md");
```

Filesystem paths always resolve beneath `root`. A single leading slash means the
resolver root, not the operating-system root. Parent traversal, outward symlinks,
backslashes, drive paths, and UNC paths are rejected. Relative roots are anchored
when the resolver is created. Missing files retain native Node.js error codes;
policy failures use `ERR_RESOLVER_OUTSIDE_ROOT` or `ERR_RESOLVER_INVALID_PATH`,
and an empty or non-string `root` throws `ERR_RESOLVER_INVALID_OPTIONS`.
The root is checked on each read until it is found. A missing root rejects that
read with Node.js's native `ENOENT` error, and a root created later becomes
readable.

Artifact paths use forward slashes on every supported host, including Windows.
Containment assumes the filesystem tree is stable during a read; this resolver
is not a race-proof sandbox for a concurrently hostile filesystem.

### HTTP resolver

Read files beneath a base URL in any runtime with the Fetch API:

```typescript
import { createHttpResolver } from "@asterdoc/resolvers/http";

const resolver = createHttpResolver({ baseUrl: "https://example.com/forms/w-9/" });

// Fetches https://example.com/forms/w-9/templates/form.pdf
const bytes = await resolver.read("/templates/form.pdf");
```

Paths follow the filesystem rules: forward slashes only, and a single leading
slash means the base URL, not the origin root. Each segment is percent-encoded.
A path that resolves outside the base URL rejects with
`ERR_RESOLVER_OUTSIDE_ROOT`, and one that names the base URL itself with
`ERR_RESOLVER_INVALID_PATH`, before any request. A 404 rejects with
`ERR_RESOLVER_NOT_FOUND`, and any other failed status with
`ERR_RESOLVER_FETCH_FAILED`. Pass `fetch` to add transport policy, such as
allowed hosts, redirect handling, timeouts, or body size limits. Redirects
follow the fetch function's own policy. An error thrown by a supplied
`fetch` passes through unchanged.

### With form rendering

Bind a resolver once, when a form with file-based layers is constructed.
Every instance you derive from it afterward — every `fill`, every render —
carries the same resolver:

```typescript
import { a } from "@asterdoc/sdk";
import { createFsResolver } from "@asterdoc/resolvers/fs";

const resolver = createFsResolver({ root: "./templates" });

const form = a.form(formSchema, { resolver });

const result = await form
  .fill({
    fields: {
      /* ... */
    },
  })
  .render({
    layer: "pdf",
  });
```

### Using subpath imports

Import each adapter from its environment-specific entrypoint:

```typescript
import { createFsResolver } from "@asterdoc/resolvers/fs";
import { createHttpResolver } from "@asterdoc/resolvers/http";
import { createMemoryResolver } from "@asterdoc/resolvers/memory";
```

### Memory resolver for testing

For testing and browser environments, use the memory entrypoint. Keys are matched exactly, and binary content (including a Node.js `Buffer`) is copied on input and output. Missing `contents`, or a value that is not a string or `Uint8Array`, throws `ERR_RESOLVER_INVALID_OPTIONS`:

```typescript
import { createMemoryResolver } from "@asterdoc/resolvers/memory";

const resolver = createMemoryResolver({
  contents: {
    "/templates/form.md": "# {{fields.title}}",
    "/assets/logo.png": myLogoBytes,
  },
});
```

## Changelog

View the [Changelog](https://github.com/asterdoc/asterdoc/blob/main/CHANGELOG.md) for updates.

## Related packages

- [`@asterdoc/sdk`](../sdk) - Asterdoc framework SDK
- [`@asterdoc/core`](../core) - Core framework behavior

## Contributing

We're open to all community contributions! If you'd like to contribute in any way, please read our [contribution guidelines](https://github.com/asterdoc/asterdoc/blob/main/CONTRIBUTING.md) and [code of conduct](https://github.com/asterdoc/asterdoc/blob/main/CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT license.

See [LICENSE](https://github.com/asterdoc/asterdoc/blob/main/LICENSE) for more information.
