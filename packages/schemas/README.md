<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=schemas" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.paradoc.dev/logo-400x400.png" type="image/png">
      <img src="https://assets.paradoc.dev/logo-400x400.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/schemas</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=schemas)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/intent/follow?screen_name=asterdoc)

</div>

[Asterdoc](https://asterdoc.com?utm_source=github&utm_medium=schemas) is **documents as code**. It lets developers and AI agents define, validate, and render business documents using typed, composable schemas. This eliminates template drift, broken mappings, and brittle glue code — while giving AI systems a reliable document layer they can safely read, reason over, and generate against in production workflows.

## Package overview

Zod schemas for Asterdoc artifacts, forms, documents, and primitives.

## Installation

```bash
npm install @asterdoc/schemas
```

## Usage

```typescript
import { FormSchema, DocumentSchema, BundleSchema, ListFieldSchema } from "@asterdoc/schemas";

// Validate a form definition
const result = FormSchema.safeParse(myFormDefinition);
if (!result.success) {
  console.log(result.error.issues);
}

// Parse and validate (throws on error)
const form = FormSchema.parse(myFormDefinition);

// Lists are recursive, so their item may be any field, including another list.
const list = ListFieldSchema.parse({
  type: "list",
  label: "Contacts",
  item: { type: "email", label: "Email", required: true },
  minItems: 1,
});
```

## Changelog

View the [Changelog](https://github.com/asterdoc/asterdoc/blob/main/CHANGELOG.md) for updates.

## Related packages

- [`@asterdoc/sdk`](../sdk) - Asterdoc framework SDK

## Contributing

We're open to all community contributions! If you'd like to contribute in any way, please read our [contribution guidelines](https://github.com/asterdoc/asterdoc/blob/main/CONTRIBUTING.md) and [code of conduct](https://github.com/asterdoc/asterdoc/blob/main/CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT license.

See [LICENSE](https://github.com/asterdoc/asterdoc/blob/main/LICENSE) for more information.

## Acknowledgments

Built with these excellent libraries:

- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation
