<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=cli" target="_blank" rel="noopener noreferrer">
    <img src="https://assets.paradoc.dev/logo-400x400.png" height="64" alt="Asterdoc logo">
  </a>
</p>

<h1 align="center">@asterdoc/cli</h1>

Asterdoc treats documents as structured, machine-readable artifacts. The CLI initializes projects, manages artifacts and registries, validates data, and runs local document workflows.

## Installation

Requires Node.js 22 or newer.

```bash
npm install -g asterdoc
```

You can also run it without a global install:

```bash
npx asterdoc --help
```

`asterdoc` and `@asterdoc/cli` publish the same CLI and both register the `asterdoc` executable. Install one package, not both.

## Quick start

```bash
asterdoc init my-project
cd my-project

asterdoc registry add @acme https://registry.acme.com
asterdoc search "lease agreement"
asterdoc add @acme/example-form
asterdoc list
asterdoc show @acme/example-form
```

A registry reference is `@namespace/name[/edition][@version]`. With no edition and no version, `asterdoc add` installs the release the registry states as its default: the current edition, latest version.

```bash
asterdoc add @acme/w-9                  # current edition, latest version
asterdoc add @acme/w-9/2024-03          # latest version of edition 2024-03
asterdoc add @acme/w-9@1.0.0            # version 1.0.0 of the current edition
asterdoc add @acme/w-9/2024-03@1.0.0    # one edition, one version
```

`asterdoc add` checks each file against the SHA-256 in the registry manifest and records the installed edition and version in `.asterdoc/lock.json`. `asterdoc search` shows every edition and version of an artifact.

To publish a registry, list your artifact source files in `registry.config.json` and compile it. Each source file is one release; files with the same `name` become the editions and versions of one artifact.

```bash
asterdoc registry make                       # writes registry.config.json
asterdoc registry catalog add forms/w-9.json # adds a source file
asterdoc registry compile --output dist      # writes dist/registry.json and each release
```

`registry compile` writes each release to `<name>/<edition>/<version>/` (or `<name>/<version>/` for an artifact with no editions). The default version is the highest version that is not a pre-release. The default edition is the one that started last and not after today. State another default in `registry.config.json`:

```json
{
  "name": "acme",
  "sources": ["forms/w-9-2024-03.json", "forms/w-9-2018-10.json"],
  "defaults": { "w-9": { "currentEdition": "2018-10" } },
  "tags": { "w-9": ["tax"] }
}
```

`asterdoc init` prompts for project details. For a non-interactive setup, pass `--yes` and `--name`:

```bash
asterdoc init my-project --yes --name "My Project"
```

## Global options

```text
-V, --version   output the version number
-h, --help      display help for command
```

Run `asterdoc <command> --help` for command-specific arguments and options. The [CLI command reference](https://docs.asterdoc.com/cli/commands) documents the full command set.

## Project files

An Asterdoc project contains `asterdoc.json` and a `.asterdoc` directory. Installed artifacts and their files are recorded in `.asterdoc/lock.json`; commit the lock file with your project.

## Related packages

- [`@asterdoc/sdk`](../../packages/sdk)
- [`@asterdoc/core`](../../packages/core)
- [`@asterdoc/schemas`](../../packages/schemas)
- [`@asterdoc/render`](../../packages/render)
