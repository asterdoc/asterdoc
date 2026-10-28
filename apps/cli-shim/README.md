# asterdoc

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
