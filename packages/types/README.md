<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=types" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/types</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=types)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

[Asterdoc](https://asterdoc.com?utm_source=github&utm_medium=types) is **documents as code**. It lets developers and AI agents define, validate, and render business documents using typed, composable schemas. This eliminates template drift, broken mappings, and brittle glue code — while giving AI systems a reliable document layer they can safely read, reason over, and generate against in production workflows.

## Package overview

Type-only contracts for the Asterdoc framework: artifact definitions, runtime data, and the renderer, formatter and resolver interfaces. The package ships no runtime code.

## Installation

```bash
npm install @asterdoc/types
```

## Usage

```typescript
import type { Form } from "@asterdoc/types";

const myForm: Form = {
  kind: "form",
  name: "my-form",
  title: "My Form",
  // ...
};
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
