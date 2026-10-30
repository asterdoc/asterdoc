<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=cli-shim" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">asterdoc</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=cli-shim)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

The documented install of the Asterdoc CLI. It runs [`@asterdoc/cli`](https://www.npmjs.com/package/@asterdoc/cli) and gives you the `asterdoc` command.

## Install

Requires Node.js 22 or newer.

```bash
npm install -g asterdoc
# or, without installing:
npx asterdoc
```

`@asterdoc/cli` is an alternative with the same version and behavior. Install one of them, not both. Each registers the `asterdoc` command, so a second global install fails with `EEXIST`.

## Documentation

Full CLI reference, configuration, and command list: [docs.asterdoc.com/cli](https://docs.asterdoc.com/cli).

For programmatic use of the framework, install [`@asterdoc/sdk`](https://www.npmjs.com/package/@asterdoc/sdk) directly.

## License

MIT
