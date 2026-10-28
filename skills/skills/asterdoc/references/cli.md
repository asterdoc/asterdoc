---
name: cli
description: The asterdoc CLI surface. Command index, preconditions, the high-use commands (init, new, validate, fix, attach, migrate, data, render, inspect, add), registries, settings, and real error messages with their fixes.
metadata:
  tags: cli, asterdoc, init, new, validate, fix, attach, migrate, data, template, extract, render, inspect, registry, add, search, errors
---

# Asterdoc CLI

**Contents:** [Install](#install) · [Preconditions](#preconditions) · [Command index](#command-index) · [Author](#author) · [Data and render](#data-and-render) · [Registries](#registries) · [Settings](#settings) · [Errors and fixes](#errors-and-fixes)

## Install

```bash
npm install -g asterdoc     # or run without installing: npx asterdoc <command>
```

Examples below use `asterdoc`. Without a global install, write `npx asterdoc` in its place. Install `asterdoc` only: `@asterdoc/cli` ships the same binary, and a second global install fails with `EEXIST`.

## Preconditions

<!-- dep:L3 -->

| Condition | Applies to | What to do |
|-----------|------------|------------|
| A project (`asterdoc.json` + `.asterdoc/`) | `add`, `list`, `version`, `apply`, `registry view`, and any `@ns/name` argument | Run `asterdoc init` first |
| A current `$schema` | Every command that reads an artifact file | Run `asterdoc migrate` (see [schemas.md](./schemas.md#schema-version)) |
| A configured registry namespace | `add @ns/name`, `search` | There is no default registry. Add one with `asterdoc registry add`. `@asterdoc` is reserved and not available yet |
| Project-root paths | `show`, `diff`, `version`, `apply` inside a project | Write relative paths from the project root |

An installed reference such as `@acme/w9` works in place of a file path for `validate`, `render`, `fix`, `show`, `data`, `attach` and `detach`. The CLI resolves it through `.asterdoc/lock.json`.

`-` reads the artifact from stdin for `validate`, `render`, `inspect` and `hash`.

## Command index

| Command | Purpose | Details |
|---------|---------|---------|
| `init [dir]` | Create `asterdoc.json` and `.asterdoc/` | [init](#init) |
| `new form\|document\|checklist\|bundle <name>` | Scaffold an artifact file | [new](#new) |
| `validate <artifacts...>` | Check schema, logic, layer files, checksums, bindings | [validate](#validate) |
| `fix <artifact>` | Add or update layer and ContentRef checksums | [fix](#fix) |
| `attach <artifact> <file>` / `detach <artifact> [target]` | Add or remove a layer, `instructions` or `agentInstructions` | [attach and detach](#attach-and-detach) |
| `migrate <path>` | Move files to the current schema version | [migrate](#migrate) |
| `version <file> <bump>` | Bump the artifact's own semver | [version, generate, hash](#version-generate-hash) |
| `generate <file>` | Write TypeScript types for an artifact | [version, generate, hash](#version-generate-hash) |
| `hash <file>` | Print a `sha256:` checksum | [version, generate, hash](#version-generate-hash) |
| `show <artifact>` | Print a summary (`--raw`, `--deps`) | [show, diff, apply](#show-diff-apply) |
| `diff <a> <b>` | Compare two artifact files | [show, diff, apply](#show-diff-apply) |
| `apply <patch>` | Apply a unified diff | [show, diff, apply](#show-diff-apply) |
| `data template\|validate\|fill\|extract` | Payload skeleton, payload check, fill, read a filled PDF | [Data and render](#data-and-render) |
| `render <artifact>` | Render a text, markdown, HTML, DOCX or PDF layer | [render](#render) |
| `inspect <pdf>` | List AcroForm field names, types and positions | [inspect](#inspect) |
| `add <targets...>` | Install a registry artifact, or a document component | [add](#add) |
| `list` (`ls`) | List installed artifacts | [Registries](#registries) |
| `search [query]` | Search a registry | [Registries](#registries) |
| `registry add\|remove\|list\|info\|view` | Manage registries | [Registries](#registries) |
| `registry make\|catalog\|compile\|stats` | Publish a registry | [Registries](#registries) |
| `check <target>` | Check a React composition | the `asterdoc-react` skill |
| `dev [dir]` | Live composition preview with a proof PDF | the `asterdoc-react` skill |
| `configure` (`config`) | Wizard: output format, artifacts dir, cache TTL, telemetry | [Settings](#settings) |
| `cache`, `reset` | Cache, renderer plugins, factory reset | [Settings](#settings) |
| `docs`, `console`, `about` | Open the docs, open the web console, print version and environment | none |

A bare name to `add` (`asterdoc add invoice`) installs a document component or block and needs a `components.json`; load the `asterdoc-react` skill for it.

Global: `-h` or `asterdoc help <command>` prints help. `-v` prints the version. `--no-telemetry` disables telemetry for one call. `ASTERDOC_NO_UPDATE_CHECK=1` turns off the update check.

## Author

### init

```bash
asterdoc init --yes --name "Lease Desk"          # --description, --visibility private|public, --dry-run
asterdoc init my-project --yes --name "Lease Desk"
```

`asterdoc.json` gets `$schema`, `name` (`@your-org/<slug>`; replace `your-org`), `title`, `description`, `visibility`. `.asterdoc/` holds `lock.json` after the first `add`; commit it. `--nested` allows a project inside another.

### new

```bash
asterdoc new form lease-agreement --yes --title "Lease Agreement" \
  --field address:address --field rent:money --field startDate:date --field tenantEmail:email \
  --format yaml
asterdoc new checklist closing --yes --item "Title search" --item "Appraisal"
asterdoc new document terms --yes
asterdoc new bundle onboarding --yes
```

The file lands in the current directory (`--dir` to change) with the current `$schema`, and YAML also gets a `yaml-language-server` comment. Other flags: `--slug`, `--description`, `--code`, `--artifact-version` (default `1.0.0`), `--dry-run`.

`--field <id:type>` works on `new form` only, and accepts only schema type names ([fields.md § Type selection table](./fields.md#type-selection-table)). An unknown type exits non-zero and lists the valid types. Every type scaffolds ready to pass `asterdoc validate`: `enum`/`multiselect` get sample options, `fieldset` gets an empty `fields`, and `list` gets a `text` `item` — edit those placeholders as needed.

### validate

```bash
asterdoc validate lease-agreement.yaml                        # human output
asterdoc validate lease-agreement.yaml --json                 # { ok, errors[], warnings[], layers[] }
asterdoc validate lease-agreement.yaml --silent --expect-kind form
asterdoc validate forms/*.yaml                                 # each file reported; exits 1 if any fails
```

<!-- dep:L1 -->
`validate` takes one or more artifacts per call and reports each one; with `--json` and more than one file, the output is an array of result objects in argument order.

What it checks, unless `--schema-only`:

| Check | Severity |
|-------|----------|
| Schema, identifiers, expressions (unknown references, boolean gates) | error |
| Layer and ContentRef files exist | error |
| `defaultLayer` names a layer | error |
| Signature slots match their layer and party roles | error |
| PDF `bindings` keys are PDF field names in the file | error |
| Template expressions in text and DOCX layers | error |
| Checksum matches the file | error: `` Checksum mismatch. Run `asterdoc fix` to update. `` |
| Checksum is set | warning: `` No checksum set. Run `asterdoc fix` to add one. `` |
| Bound values fit PDF text fields | warning |

<!-- dep:C7 -->
Exit 0 is a trustworthy gate for these checks. The final check for a form is still the [round trip](#round-trip).

Exit 0 means no errors; warnings keep exit 0. `--checksum-only` checks only checksums. For the error messages, see [schemas.md](./schemas.md#error-messages).

### fix

```bash
asterdoc fix lease-agreement.yaml --dry-run
asterdoc fix lease-agreement.yaml -y
```

`fix` writes checksums for file layers and file ContentRefs, and nothing else. It runs only on a schema-valid artifact.

### attach and detach

```bash
asterdoc attach lease-agreement.yaml terms.md -y                   # layer key from the file name: terms
asterdoc attach lease-agreement.yaml lease.pdf -n pdf -t "Lease PDF" -y
asterdoc attach lease-agreement.yaml guide.md --as instructions -y # or --as agent-instructions
asterdoc detach lease-agreement.yaml pdf -y                        # or: instructions, agent-instructions
```

`attach` sets `kind: file`, `path`, the detected `mimeType` (`-m` overrides) and the checksum. Write a PDF layer's `bindings` yourself from `asterdoc inspect` output ([pdf.md § Bindings](./pdf.md#bindings)). `--dry-run` previews both commands.

### migrate

```bash
asterdoc migrate forms/ --dry-run                 # print each diff, write nothing
asterdoc migrate forms/                           # rewrite in place; JSON stays JSON, YAML keeps comments
asterdoc migrate lease.json --from 2026-10-28     # $schema missing, undated, unpublished, or not Asterdoc's
```

Each file reports `migrated`, `current` or `failed`. A failed file stays as it was, and the command exits 1. When a step names a value it cannot convert, fix that value by hand and run `migrate` again. Files that are not artifacts are skipped. To bump the artifact's own `version`, use `asterdoc version`.

### version, generate, hash

```bash
asterdoc version lease-agreement.yaml minor       # major|minor|patch|premajor|preminor|prepatch|prerelease|<x.y.z>
asterdoc generate lease-agreement.yaml            # lease-agreement.json + .d.ts
asterdoc generate lease-agreement.yaml --output ts
asterdoc hash lease.pdf                           # sha256:<64 hex>; --json for details
```

### show, diff, apply

```bash
asterdoc show lease-agreement.yaml --deps
asterdoc diff v1.yaml v2.yaml                     # exit 0 same, 1 different, 2 error
asterdoc apply change.patch --check               # --dry-run, --reverse
```

`diff` prints a colored view for people. `apply` needs a project and takes a standard unified diff, for example from `git diff`.

## Data and render

### data template

```bash
asterdoc data template lease-agreement.yaml --out sample.json --silent
```

The skeleton holds placeholder values by type, not `null`:

| Type | Placeholder |
|------|-------------|
| text, email, date and other string types | declared `default`, then `""` |
| `boolean` | `false` |
| `money` | `{ "amount": 0, "currency": "USD" }`, even when the field declares another currency |
| `enum` | the first option |
| `multiselect`, `list` | `[]` |
| `number`, `percentage`, `rating` | `null` |
| `duration` | `"PT0S"` |
| `coordinate`, `bbox` | zero-valued coordinates |
| `address`, `person`, `fieldset` | an object of the parts above |

Replace every placeholder with real sample values. An unedited template can pass `data validate`, so a pass proves nothing until the values are real.

### data validate

```bash
asterdoc data validate lease-agreement.yaml sample.json          # --json, --silent
asterdoc data validate lease-agreement.yaml '{"fields":{"rent":{"amount":1800,"currency":"USD"}}}'
```

<!-- dep:L4 -->
`data validate` runs the SDK validators: fields, parties, annexes, expression-based `required`, and unknown top-level keys. Parties go under `parties.<role>` ([parties.md § Party fill values](./parties.md#party-fill-values)).

### data fill

```bash
asterdoc data fill lease-agreement.yaml --out filled.json                     # interactive prompts
asterdoc data fill lease-agreement.yaml --data sample.json --out filled.json  # non-interactive: validate, then write
```

`--out` is required in both modes. `--data` switches to non-interactive mode; it does not seed the prompts. With `--data`, validation is the same as `data validate`, and the output holds the filled `fields` (with defaults), `parties`, and `annexes`.

### render

```bash
asterdoc render pet.yaml --data sample.json --out pet.pdf
asterdoc render pet.yaml --data sample.json --layer markdown --out pet.md
asterdoc render pet.yaml --data sample.json --bindings extra-bindings.json --out pet.pdf
asterdoc render pet.yaml --data sample.json --dry-run --format json
```

- Pass `--out`. Without it the rendered bytes, binary PDF included, go to stdout.
- `--layer` defaults to `defaultLayer`, then the first declared layer. The layer MIME type picks the renderer.
- Pass `--data` with a complete valid payload to fill values. Without it the raw layer renders unfilled, with no warning. Use SDK progressive rendering for an incomplete draft.
- `--format json` shapes only the success message after `--out` and the `--dry-run` summary.
- `--bindings` merges over a PDF layer's `bindings`; the CLI value wins. Any other layer refuses it.
- React (`text/tsx`) layers require the SDK renderer described by the `asterdoc-react` skill.

For render options and their SDK equivalents, load [rendering.md](./rendering.md).

### data extract

```bash
asterdoc data extract pet.yaml pet.pdf --out extracted.json
asterdoc data extract 1099-nec.yaml ./filled --layer pdfCopyB --out extracted.json
```

It reads AcroForm values back through the PDF layer's `bindings`. Output per file is `{ file, layer, data, report }`, where `data` is a `{ fields, parties }` payload; the report statuses are in [filling.md § Extract from a filled PDF](./filling.md#extract-from-a-filled-pdf). A directory gives `{ results: [...] }` and exits 1 when any file fails. Run `data validate` on `data`, because extraction does not validate. A layer with no `bindings` fails with `Error (not_matching)`.

### inspect

```bash
asterdoc inspect lease.pdf --format json --out fields.json
asterdoc inspect lease.pdf --summary
asterdoc inspect lease.pdf --filter "Tenant*" --include-buttons --include-signatures
```

Each entry has `name`, `type`, `value`, `required`, `rect` and, for text, `maxLen`. The `name` values are the keys of a PDF layer's `bindings`. See [pdf.md](./pdf.md).

### Round trip

The finish line for a form with a layer:

```bash
asterdoc data template pet.yaml --out sample.json --silent   # then replace every placeholder
asterdoc data validate pet.yaml sample.json
asterdoc render pet.yaml --data sample.json --out pet.pdf
asterdoc data extract pet.yaml pet.pdf --out extracted.json  # PDF: every entry "recovered"
```

When you author a form, follow the full sequence in [workflow-author-form.md](./workflow-author-form.md).

## Registries

### add

```bash
asterdoc registry add @acme https://registry.acme.com --header "Authorization: Bearer \${ACME_TOKEN}" -y
asterdoc add @acme/residential-lease --layers all          # or --layers pdf,markdown
asterdoc add @acme/w-9/2024-03@1.0.0                       # one edition and one version
asterdoc add @acme/residential-lease --output yaml         # json | yaml | typed | ts
asterdoc add @acme                                         # pick from the namespace interactively
asterdoc add https://example.com/r/form.json --header "Authorization: Bearer TOKEN"
```

`add` writes the artifact to `<artifactsDir>/<namespace>/` (default `artifacts`) and records it in `.asterdoc/lock.json`, keyed by `@ns/name`, with its version and its edition when it has one. Pass `--layers` to download layer files. ContentRef files (`instructions`, `agentInstructions`) always download. `--no-cache` or `--cache-ttl 0` fetches fresh.

A reference is `@ns/name[/edition][@version]`. An edition is the issuer's revision of a form (IRS W-9 Rev. March 2024 is `2024-03`); a version is the publisher's revision of the artifact for that edition. An omitted edition is the current edition (also written `current`); an omitted version is the latest version (also written `latest`). The publisher states both defaults in `registry.json`; the CLI never compares dates or version numbers. `@acme/w-9@1.0.0` is version 1.0.0 of the current edition, or of an artifact with no editions. A reference to an edition or version the registry does not list fails and names the ones it lists. `add` refuses a file whose SHA-256, name, version or edition differs from what the manifest lists. A direct-URL `add` reads no manifest, so it has no checksum or identity check. A project holds one release of an artifact: adding another edition or version replaces it. `search` lists every edition and version.

<!-- dep:L3 -->
Every namespace needs `registry add` first ([Preconditions](#preconditions)).

### Find and inspect

<!-- dep:L3 -->
```bash
asterdoc search lease                               # the one configured registry
asterdoc search tax --registry @acme --kind form --tags irs --json
asterdoc list --kind form --json                    # installed artifacts
asterdoc registry list                              # configured registries (ls)
asterdoc registry info @acme --json                 # registry-level details
asterdoc registry view @acme/residential-lease      # an installed artifact, after add
asterdoc registry remove @acme --global             # rm; with no namespace it prompts
```

`registry add` writes to `asterdoc.json` with `--project`, or to `~/.asterdoc/config.json` with `--global`. Given only a URL, it discovers the namespace. `-y` overwrites an existing entry, which is also how to change a token or header.

A registry entry is a URL string or an object:

```json schema=registries
{
  "@acme": {
    "url": "https://registry.acme.com",
    "headers": { "Authorization": "Bearer ${ACME_TOKEN}" },
    "cache": { "ttl": 600 }
  },
  "@public": "https://registry.example.com"
}
```

`${VAR}` expands in `url` and in header values. Keep a token in the environment variable and rotate it there. `HTTPS_PROXY` and `HTTP_PROXY` are honored. ### Publish

```bash
asterdoc registry make ./my-registry --name acme -y           # writes registry.config.json
asterdoc registry catalog add forms/w-9-2024-03-1.0.0.json    # one source file = one release
asterdoc registry catalog remove w-9 -y                       # a name (every release) or one source path
asterdoc registry compile --output dist                       # writes dist/registry.json and the release folders
asterdoc registry stats -r dist/registry.json --json          # checks the manifest, then counts
```

The publisher's source is `registry.config.json`: `name`, `description?`, `homepage?`, `sources` (artifact file paths, in its folder or below), `tags` (by artifact name) and `defaults` (by artifact name). `make`, `catalog` and `compile` take `-c, --config <path>`. `registry.json` is compile output only; never edit it. Source files with the same `name` are the editions and versions of one artifact, and an artifact has an `edition` in every release or in none.

`compile` writes each release to `<name>/<edition>/<version>/<name>.json` (`<name>/<version>/` with no editions), copies referenced files beside it, and writes the manifest with each release's `path` and `sha256`. It is all or nothing: one error and no file is written. Defaults it chooses: `latestVersion` is the highest version that is not a pre-release; `currentEdition` is the only edition, else the one with the latest `effectiveFrom ?? date` not after today. When it cannot choose, it fails and names the entry to set, such as `defaults["w-9"].currentEdition` or `defaults["w-9"].editions["2024-03"].latestVersion` (`defaults["<name>"].latestVersion` with no editions).

A published version never changes: a fix is a new source file with a new version. To withdraw a version, remove its source file and compile again. Full reference: [docs.asterdoc.com](https://docs.asterdoc.com).

## Settings

Precedence: CLI flags, then `asterdoc.json`, then `~/.asterdoc/config.json`, then built-in defaults. `asterdoc configure` sets the output format, artifacts dir, cache TTL and telemetry. Registries and headers are set with `asterdoc registry add`.

```json schema=cli-config
{
  "defaults": { "output": "yaml", "artifactsDir": "artifacts" },
  "registries": { "@acme": { "url": "https://registry.acme.com" } },
  "cache": { "ttl": 3600 },
  "telemetry": { "enabled": false }
}
```

An unknown key or invalid JSON in the global config stops every command with an error that names the file and each bad key.

| Command | Use |
|---------|-----|
| `cache stats` (`info`), `clear`, `invalidate @ns`, `config`, `reset [--clear]` | Registry cache |
| `reset [-y] [--keep-registries] [--keep-cache]` | Factory reset of global config and cache |

Telemetry is also off with `ASTERDOC_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`.

## Errors and fixes

| Message | Fix |
|---------|-----|
| `asterdoc: command not found` | Use `npx asterdoc`, or `npm install -g asterdoc` |
| `Not in an Asterdoc project. Expected asterdoc.json with a .asterdoc directory.` | Run `asterdoc init` in the project root |
| `No registry is configured for @acme. Run: asterdoc registry add @acme <url>` | Add the registry: `asterdoc registry add @acme <url>` |
| `No registry to search. Pass --registry @<namespace>, or add one first: ...` | Add a registry, or pass `--registry @acme` |
| `Several registries are configured (...). Pass --registry to choose one.` | Pass `--registry @acme` |
| `The Asterdoc registry is not available yet, ...` | `@asterdoc` is reserved and cannot be added. Use another registry |
| `Environment variable not set: ACME_TOKEN` | Export the variable a registry `url` or header names |
| `"w9" is not a document component.` | Name the registry: `asterdoc add @acme/w9` |
| `Artifact not installed: @acme/lease` / `Artifact "@acme/lease" is not installed.` | `asterdoc add @acme/lease` |
| `The artifact was written for schema version <v>; ...` | `asterdoc migrate <file>` |
| `The artifact has no $schema; ...` / `$schema ... names no schema version; ...` | `asterdoc migrate <file> --from <version>` |
| `` Checksum mismatch. Run `asterdoc fix` to update. `` | `asterdoc fix <file> -y` |
| `Error: Invalid artifact: <path>: <message>` (from `fix`) | Fix the listed schema errors by hand, then run `fix` |
| `✗ Schema validation failed:` with a path | Look up the message in [schemas.md](./schemas.md#error-messages) |
| `error: unknown option '--verbose'` | Use `--json` for structured output |
| `error: required option '--out <file>' not specified` | Add `--out` (`data fill`) |
| `Error (not_matching): Layer "<key>" has no bindings ...` | Add `bindings` to the PDF layer ([pdf.md](./pdf.md)) |
| `Error (unknown_bindings_source): Layer "<key>" takes its bindings from "<name>" ...` | Point `bindingsFrom` at an existing PDF layer |
| `Layer "composition" has MIME type text/tsx and no renderer is registered for it` | Render React layers with the SDK renderer in the `asterdoc-react` skill |
