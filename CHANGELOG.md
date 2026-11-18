# Changelog

All notable changes to Asterdoc (named Paradoc through 0.8). Packages are versioned in lockstep.

## [Unreleased]

Under this release, valid data never fails at render without warning. `validate()` answers one question, whether the data matches the artifact, and reads no layer. Whether valid data renders on a PDF layer is that layer's render check, `draft.renderProblems(layer)`; a render runs the same check first and refuses with the same report before drawing. A form loads with `await form.load(definition, { resolver })`, which reads every PDF layer once for that check. PDF text draws in the standard PDF fonts, which an artifact may choose per layer or per binding. Prints that fail for some value the artifact accepts are refused at artifact validation, and the field gets the constraint that keeps such values out. It adds schema version 2026-11-17.

### Highlights

- `await form.load(definition, { resolver })` is the one way to get a form instance. It reads every PDF layer into a print profile of each field.
- `draft.renderProblems(layer)` is the render check of a layer: a value that overflows its field, does not fit a comb, or has a character the field's font cannot draw, each at `fields.<path>` with code `unprintable`, the `layer` and the `pdfField`. `render()`, `prepareSeal()` and `seal()` run it first and throw `RenderRefusedError` with the same `problems`. The check and the render measure with the same code.
- PDF text draws in Helvetica, a standard PDF font every viewer has, so nothing is embedded, whatever font the PDF field itself names. An artifact may choose Courier (monospace) for a PDF layer (`"font": "Courier"`), or `"Helvetica"` or `"Courier"` for a binding object, over the layer (`{ "path": "fields.ssn", "font": "Courier" }`). A layer's TrueType font stays opt-in; it is tried first and embedded as a subset of the glyphs drawn.
- A phone field takes `countryCode`, the country calling code every number must have (`"1"` for the North American plan). Fill refuses a number of another plan, or one that is not valid in the plan.
- Artifact validation reports a list a PDF layer binds by row that can hold more items than the rows bound, binds rows with a gap, or binds fewer members in a later row, or binds a row at or past its `maxItems`, which never fills. Give the list `maxItems`. Render no longer throws at fill time for too many items.
- Artifact validation reports `country.display` or `region.display` on an address without `"codes": true`, in PDF, text and DOCX layers.
- Artifact validation reports a PDF binding or placeholder that prints `areaCode` or `subscriberNumber` of a phone field without `"countryCode": "1"`, a `phone.region` style on a phone field of another plan, and a money `units` or `cents` part on a field that accepts other currencies or amounts below zero. Each message names the field and what to add. Before, such a form rendered for some data and failed at render for other valid data.

### Breaking changes

#### Schemas

- Schema 2026-11-17 adds `countryCode` to phone fields, and a standard font name (`"Helvetica"` or `"Courier"`) as a PDF layer's `font` and as a binding object's `font`. An artifact on 2026-11-12 or earlier loads with nothing added. If it binds `areaCode` or `subscriberNumber`, or prints a phone under `phone.region` with `national`, `digits` or a part, on a phone field without the matching `countryCode`, `validate` and `npx asterdoc migrate` refuse it and name the field and the code to add.

#### Core

- `a.form(definition)`, `form.from`, `form.safeFrom`, `loadFromObject`, `safeLoadFromObject` and `validateFormData` are removed. Use `await a.form.load(definition, options)` or `await a.form.safeLoad(...)`. A form builder's `.build()` returns the definition; pass it to `a.form.load`. `a.form()` with an argument throws a `TypeError` that names `form.load`.
- `load()` and `safeLoad()` are async and take a string or an object. `runtimeFormFromJSON`, `runtimeBundleFromJSON` and `runtimeContentFromJSON` are async.
- A form with a PDF layer needs its resolver at load. A layer that cannot be read throws `LayerReadError`, naming the file that failed, and a missing resolver throws `UnboundResolverError`.
- A render of valid data that a PDF layer cannot draw throws `RenderRefusedError` before drawing, in place of a `PdfFieldFillError` from the middle of the render. `seal()` and `prepareSeal()` refuse the same way.
- The `bindings` render option is removed, and `render()` refuses an option it does not have. A PDF layer fills from the bindings the artifact declares, the same bindings the render check reads. To change a binding, edit the artifact.
- Artifact validation refuses a phone `countryCode` that no numbering plan has (a country's, or a non-geographic one such as +800), and a default number whose parsed calling code is not the field's `countryCode`. The schema checks only the code's shape.
- Artifact validation refuses a binding to a PDF text or choice field with more than one widget, naming the field and its pages: a value would print in every widget. Split the field in the PDF into one field per widget.
- Artifact validation with the layer files (`validateLayers`, `asterdoc validate`) refuses a field `default` that a PDF layer cannot print: it does not fit its box, or has a character the field's font cannot draw. The error names the field, the layer and the cause.
- `validateLayers` and `asterdoc validate` run the full render check (overflow, comb length, mask, glyphs) on the values of each test in `tests` whose data is valid; 0.13 checked only that the layer's fonts could draw them. A test whose data is not valid is not rendered. A valid test whose values do not print is now an error.
- `form.load` refuses a PDF layer binding key that is not a field of the PDF, with the `PdfBindingKeyError` a render throws.
- `asterdoc generate` for a form writes `schema` and `load<Name>(options)` in place of a constructed instance.
- Artifact validation refuses a bound list without `maxItems` within its bound rows, a place format on an address without `codes: true`, and the prints above. Give the phone field `"countryCode": "1"` (or the region's code), and the money field a two-decimal `currency` and `"min": 0`.

#### Render

- A PDF render refuses, before any value, a layer that prints a phone `areaCode` or `subscriberNumber` on a field without `"countryCode": "1"`, a `phone.region` style or part on a field of another plan, or a money `units` or `cents` part on a field that accepts other currencies or amounts below zero, with `PdfPrintRuleError`.
- `pdfRenderer({ font })` and the `font` option of `createLayerRenderer` are removed. A layer's TrueType font travels with the artifact; `RenderPdfOptions` takes `layerFont` and `standardFont`.
- The font a PDF field itself names (an embedded font, Times-Roman or Courier) is no longer drawn with: the field draws in Helvetica unless the artifact chooses Courier.
- `pdfFontCheck` and `fontCoverage` are removed. The render check does the work.

#### Format

- `PhoneProvider` has `knowsCallingCode(code)`. A custom phone provider must add it.

#### Essentials

- Each essential exports `{ spec, resolver, load() }`. `await w9.load()` returns the form instance.

#### Sessions

- `createAsterdocRuntime` is async and takes `resolver`.

#### AI tools

- A form tool loads its form with `form.load`, with the resolver of its `base_url`. `complete` is `draft.isValid()`: the data matches the artifact. The render tool returns the render check's report as `errors`, with `error.code` `render_refused`, when a layer cannot draw the data.
- `artifactFileResolver(artifact, base_url, config)` is exported: the resolver the tools read an artifact's layer files with, for a host that loads the form itself.
- A form tool needs `base_url` for a form with a PDF file layer, since loading the form reads the PDF. Without it, the tool returns `error.code` `layer_files_unreachable`, which says what to give; a file it cannot read returns `layer_file_unreadable`. A layer file that matches its declared checksum is kept for the tools config that read it, so later calls through that config do not fetch it again. A host that serves several tenants gives each tenant its own config. Every artifact kind gets these codes, and `layer_checksum_mismatch` for a file that does not match its checksum.

#### CLI

- A form whose PDF file is missing fails to load with a message that names the layer and the path.
- `asterdoc data validate` takes `--render-check <layer>`, and `asterdoc render` prints the render check's report when it refuses.
- `asterdoc inspect` lists every widget of a field: a `Pages` column, a list of each widget of a field with several, and `widgets` in `--format json`.
- `asterdoc render --bindings` is removed. A PDF layer fills from the bindings the artifact declares.
- `asterdoc validate` fails a form whose own tests did not run because the form did not load, for example from stdin with its PDF out of reach, and names why. Before, the tests were skipped and the form was valid.

### Upgrading from 0.13

1. Replace `a.form(definition)`, `form.from`, `loadFromObject` and `.build({ resolver })` with `await a.form.load(definition, { resolver })`, and await `load()`, `runtimeFormFromJSON` and `createAsterdocRuntime`. Remove `pdfRenderer({ font })`.
2. Where a caller relied on a render error for a value that does not fit, call `draft.renderProblems(layer)` before the render, or catch `RenderRefusedError`.
3. Run `npx asterdoc validate` on your artifacts. For each print it names, add the `countryCode`, `currency` or `min` it asks for.
4. For each valid test that `npx asterdoc validate` now says does not print, bound the field (a `maxLength` that fits the box), bind its parts, or change the test's values.
5. Run `npx asterdoc migrate <file>` to write the new `$schema`. This step is optional: older dates load upgraded in memory. A 2026-11-12 form that binds a phone `areaCode` or `subscriberNumber`, or prints a phone under `phone.region`, without the matching `countryCode` does not migrate silently: `migrate` and `validate` refuse it, name the field and the `countryCode` to add (step 3), and the form migrates once it has it.

### Core

- `phoneField().countryCode('1')` in the field builders.

### Render

- `PdfFieldInfo` has `widgets`: each widget's `page` and `rect`. `page` and `rect` stay the first widget's, and `page` is now also found through the page's annotations.
- `readPdfPrintProfile` and `pdfPrintFailures` read a PDF layer's print profile and check data against it.
- `layerPrintProblems(form, bindings, format)` lists the prints of a PDF layer that fail for some accepted value. `BindingTemplate.slots` lists every placeholder of a binding template.

### Sessions

- `FormSession.artifactRef.baseUrl` keeps the base URL of the version a session opened, so a later turn reads that version's layer files, not the latest version's.

### Skills

- The asterdoc skill describes `countryCode`, schema 2026-11-17, `form.load`, the standard PDF fonts and the render check.

## [0.13.0] - 2026-11-16

0.13 lets one PDF field print several values with a binding template, and adds a batch fill path for agents: `fillBatch()`, `asterdoc data next`, `render --draft` and `render --check`, and the new asterdoc-fill skill. It adds schema version 2026-11-12. Artifacts on older schema versions keep loading: the SDK upgrades them in memory, and turns each comma-joined binding into a template.

### Highlights

- A PDF binding can be a template (`{ template: "{{fields.city}}, {{fields.state}} {{fields.zip}}" }`) with format modifiers, `{{#if}}` and `{{#unless}}` blocks, and line breaks for a multi-line field. Fill, the fit check and extraction read it.
- `fillBatch(form, state)` and `draft.getFillBatch()` describe each target open now, with its label, type, options, shape, format and limits, and report unmet rules. `asterdoc data next` prints the same batch, with the PDF page of each field.
- `asterdoc render --draft` renders data that is not complete and lists what is open. `asterdoc render --check` reads the PDF back and compares it with the data.
- A new skill, asterdoc-fill, teaches an agent the fill loop: `data next`, write a batch, repeat, check the data against the facts, render.
- `validate()` names values given for fields that do not apply, and parties whose name a PDF layer does not print. Before, such a form rendered with the value printed, or with the name empty.
- `validateLayers()` checks each test value of a form against the fonts of its PDF layers. A value that no font can draw names the artifact path it comes from.
- `asterdoc inspect` lists the options of a dropdown and of a radio group: the value the PDF stores and the text it shows.

### Breaking changes

#### Schemas

- Schema 2026-11-12 refuses a comma-joined PDF binding such as `"city, state"`. Write a template binding. An artifact on 2026-11-10 or earlier loads with each joined binding turned into the template that prints the same text; `npx asterdoc migrate <file>` rewrites the file.

#### Core

- `validate()` reports a value given for a field hidden by a condition that is not met (`notApplicable`), and a party whose name a PDF layer does not print (`unprintedNames`). `prepareForSigning()`, `seal()` and `asterdoc render` refuse such a form. `fill()` still accepts it. Remove the value, or give the name members the layer prints (such as `firstName` and `lastName`, or `legalName`).
- `validateLayers()` reports a test value that the fonts of a PDF layer cannot draw. Set the layer's `font`, or change the test value.

### Upgrading from 0.12

1. Run `npx asterdoc migrate <file>` on each artifact you store on 2026-11-10 or earlier. This step is optional: older dates load upgraded in memory.
2. Run `npx asterdoc validate` on your artifacts and fix each `notApplicable`, `unprintedNames` and font report.

### Core

- `fillBatch()` and `draft.getFillBatch()`: the targets open now, the count that waits behind unfilled answers, unmet rules, values that do not apply and names that do not print.
- A form that renders a payload computes its defs, so a PDF box bound to a def no longer prints empty.
- A party that can be a person or an organization is read as a person when it gives only `name`; an organization that gives `legalName` prints on a layer that binds `legalName`.
- `PdfFieldFillError` holds `paths`, the artifact paths the field prints, and its message names them.

### Render

- PDF template bindings, and `pdfBindingPages()` in `@asterdoc/render/pdf`, the page each bound field prints on.
- The font advice of a fill error names the `font` of the PDF layer first.

### CLI

- `asterdoc data next <form> [--data <file>] [--layer <name>] [--full] [--json]`.
- `asterdoc render --draft` and `asterdoc render --check`.
- `asterdoc inspect` lists dropdown and radio options and shows which text fields are multi-line.
- A command writes all its output to a pipe before the process ends. Before, output over 64 KB to a pipe was cut on macOS with exit code 0.
- The update notice goes to stderr, and only when stderr is a terminal.

### Skills

- New asterdoc-fill skill.
- The asterdoc skill (0.13.0) describes template bindings and schema 2026-11-12.

## [0.12.0] - 2026-11-10

0.12 lets a form choose how each value prints: a country as its code or its name, a phone in one of several styles, an identifier with or without its mask, any part of a date, phone or amount. It adds check-digit rules, sensitive values, test cases inside artifacts, and verified template checksums, and a new schema version, 2026-11-10. Artifacts on older schema versions keep loading: the SDK upgrades them in memory.

### Highlights

- A `format` on any layer that prints values (PDF, text, Markdown, HTML, DOCX, React), on a single PDF binding (`{ path, format, part }`), on a template placeholder (`{{ fields.phone | phone=national }}`) or on a React element. With no format, output is the same as in 0.11.
- New `country` and `region` field types, `codes: true` on addresses, and `mask` on text fields. Input in names, codes or formatted text is stored as one canonical value, and agents get candidates when an answer is ambiguous.
- Rules can check identifiers with `checkDigit` (Luhn, ISO 7064 MOD 97-10 and MOD 11-2, Verhoeff, Damm) and `weightedMod`, use `substring`, `charAt` and `split`, and attach their failure to field `paths`.
- Fields can be `sensitive`: rule explanations and AI tool errors print `[redacted]` with the value's kind and length.
- An artifact can carry its own `tests`, run by `runTests()` and `asterdoc validate`.
- Render and seal verify layer and font checksums, and a seal records the definition's `contentHash`.
- Older schema versions upgrade in memory on load, so no artifact needs to be migrated or republished.

### Breaking changes

#### Core

- `assertCurrentSchemaVersion` is removed. An artifact on an earlier schema version now upgrades in memory on load. To refuse every version but the current one, call `upgradeArtifact(artifact, { required, strictSchema: true })`, which throws the same `SchemaVersionError`.
- Render and seal check a file layer's `checksum`, and its font's, against the bytes the resolver returns, and throw `LayerChecksumError` (layer, path, expected and actual digest) when they differ. A layer with no checksum renders as before.
- A runtime's `toJSON()` writes a copy of the definition as it was read, at its own `$schema`, while the definition it was filled from is unedited; otherwise, and for a definition made in memory, it writes the definition with the current `$schema`. A restore keeps the content hash.
- A definition string or property name with an unpaired UTF-16 surrogate is a validation issue at its path, and reading such a definition fails.
- A runtime's definition (`form`, `document`, `checklist`, `bundle`) is a frozen snapshot taken at fill or prepare: writing to it throws. Edit the authoring definition and fill again.
- An instance's `migratedFrom` is `undefined` once its definition is edited after it was read. A definition read from a file and edited to hold a value with no JSON form throws `DefinitionNotJsonError` from `clone()` and `contentHash()`.
- Every framework package needs Node 20 or later (`engines.node` was `>=18`): render and seal use `globalThis.crypto`. The AI integration packages (`ai-sdk`, `ai-tools`, `tanstack-ai`, `mastra`) keep their Node 22 requirement.

### Upgrading from 0.11

1. Use Node 20 or later for the framework packages.
2. Replace `assertCurrentSchemaVersion` with `upgradeArtifact(artifact, { required, strictSchema: true })` where you must refuse older schema versions.
3. Run `asterdoc validate` on your artifacts: a layer or font whose `checksum` no longer matches its file now fails render and seal. Correct the checksum or the file.
4. Edit an artifact's authoring definition, not a runtime's: a runtime's definition is frozen.

### Other changes

#### Schemas

- Schema version `2026-11-10`. Every change is additive to `2026-11-06`, and artifacts on older dates are upgraded on load. A date newer than the SDK knows fails with "newer than this SDK knows; update @asterdoc/core".
- `format` on every layer kind that prints values, with `country`, `region`, `phone`, `choice`, `boolean`, `person`, `text.mask`, `case`, `locale`, and `money.fractionDigits` and `useGrouping`. `money.currencyDisplay` is optional.
- A PDF binding can be an object, `{ path, format?, part? }`.
- Field types `country` (ISO 3166-1 alpha-2) and `region` (full ISO 3166-2 code, optional `country` constraint). `codes: true` on `address` fields, `mask` on `text` fields, and `sensitive` on fields.
- Rule `paths`, and a form `tests` section.

#### Expressions

- `checkDigit(value, algorithm)` for `luhn`, `mod97-10`, `mod11-2`, `verhoeff` and `damm`; `weightedMod(value, weights, modulus)`; and the string tools `substring`, `charAt` and `split`, which count UTF-16 code units.

#### Format

- `@asterdoc/format/phone` (libphonenumber-js) and `@asterdoc/format/regions` (ISO 3166-2 subdivisions with English names) are lookup providers. A formatter from `createFormatter()` carries neither; the default formatters of the SDK, render, CLI and `@asterdoc/react-pdf/formatter` carry both.
- Country normalization, region lookup and mask parsing, with structured outcome codes (`ambiguous_country`, `unknown_region`, `mask_mismatch` and others).
- `MoneyFormatOptions` takes `fractionDigits` and `useGrouping`.

#### Render

- PDF, text and DOCX layers print each value with its layer, binding and placeholder formats. A format that cannot print a value throws `ArtifactFieldFormatError`, with the code in `issues[].code`.
- Template placeholders take format modifiers, `{{ path | key=value }}`, checked with the template.
- A PDF binding can print one `part` of a date, phone, amount or masked value.
- The fit check measures the widest value a format can print. Reading a filled PDF back marks a value `lossy` when its format dropped information.

#### Core

- `canonicalizeFieldValue`: `country`, `region`, `codes: true` address and masked fields are stored canonical on every write path. `validateFieldInput` returns the outcome code and candidates, and `fieldInputGuidance` and `placeDisplayNames` help agents ask for and show these values.
- A failed rule attaches to its `paths`, and its id is the stable code. A failed rule's explanation prints the values it read, with sensitive values redacted unless `explain: { raw: true }`.
- `runTests()` runs an artifact's test cases; each can set `context.asOf`.
- `DraftForm.render({ require: 'complete' })` refuses a draft with an error-severity failure.
- `contentHash()` on every artifact instance and runtime: the `sha256:` digest of the RFC 8785 canonical JSON of the definition as stored, at the schema version it declares. `canonicalJson` and `contentHashOf` are exported.
- `verifyLayerChecksum` is exported: it checks bytes against a layer's or font's declared checksum the way render and seal do, and throws `LayerChecksumError` on a mismatch.
- A form seal records `integrity`: `contentHash`, `sdkVersion`, `migratedFrom`, and `uncovered`, the content the hash leaves out (a layer file or font with no checksum, a React module, a renderer or adapter supplied at seal time). `sealBundle` records the bundle's and each artifact part's, lists every annex supplied as bytes, and reads the bundle at the current schema version.

#### Sessions

- Coercion gets the whole field and the session's locale, so country, region and masked answers are stored canonical, and refusals keep their outcome code.

#### AI tools

- Fill tools store a place name as its code and return candidates for an ambiguous or unknown answer. Results carry `display` and `lossy` beside the stored data. Sensitive values are redacted in tool errors.

#### React

- A React layer's `format` and an element's `format` on the printing hooks; `createValueFormatter` and `formatByType`. The browser default formatter carries no phone or regions provider, so neither ships in a browser bundle unless you add it.

#### React PDF

- `@asterdoc/react-pdf/formatter`: a formatter with every lookup provider. The PDF renderer and its check apply layer and element formats.

#### Essentials

- The bundled forms are at version 1.1.0, on schema `2026-11-10`: ACH routing numbers pass the ABA check, account numbers, SSNs, EINs, ITINs and identity document numbers are sensitive, and each form carries its own test cases.

#### CLI

- `asterdoc validate` runs an artifact's test cases, and warns when a test sets a sensitive field.
- `asterdoc validate` says what a missing checksum on a layer file or font costs: render and seal cannot verify it, and the content hash does not cover it.
- `asterdoc data template` knows the `country` and `region` field types.

## [0.11.0] - 2026-11-07

0.11 makes filled PDFs more faithful to the form: dates print in the box's own pattern, foreign addresses print, and XFA forms show their filled fields. It adds schema version 2026-11-06, and the CLI now needs Node 24.14 or later.

### Highlights

- A PDF layer can declare `format.date.pattern` (`MM/DD/YYYY`, `DD/MM/YYYY` or `YYYY-MM-DD`). Fill prints every date in it, and extraction reads it back by the same pattern.
- An address in a country with no address layout prints in the generic layout, in place of stopping the render.
- Filling a PDF removes its XFA form, so every viewer shows the filled fields.
- The CLI uses Node's built-in fetch and proxy support. It honors `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, and no longer depends on undici.

### Breaking changes

#### Schemas

- The current schema version is `2026-11-06`. The SDK loads only artifacts on it: run `asterdoc migrate` on artifacts on `2026-10-28`.

#### CLI

- `@asterdoc/cli` and `asterdoc` need Node 24.14 or later.

### Upgrading from 0.10

1. Use Node 24.14 or later for the CLI.
2. Run `asterdoc migrate <path>` on your artifact files. The step from `2026-10-28` changes only `$schema`.
3. Install registry artifacts again to get their versions on `2026-11-06`. The public registry lists only those.

### Other changes

#### Format

- Exports `UNSUPPORTED_COUNTRY_LAYOUT`, the code a formatter gives for a country with no address layout.

#### Render

- A fill that drops an XFA form writes the PDF whole, so no XFA bytes and no earlier revision stay. A template without XFA is still filled as an incremental update.
- `writePdf` records each object's own generation number in the cross-reference table.

## [0.10.0] - 2026-10-31

0.10 renames the builder namespace from `p`, which stood for Paradoc, to `a`, for Asterdoc. Nothing else in the API or the artifact format changes.

### Highlights

- Build artifacts with `a`: `import { a } from "@asterdoc/sdk"`, then `a.form()`.

### Breaking changes

#### Core

- The builder namespace is now `a`, for Asterdoc. Import `{ a }` from `@asterdoc/core` or `@asterdoc/sdk` and write `a.form()`, `a.field.text()` and `a.party()`. `p` is removed.
- `asterdoc generate` and the code generator write `a.<kind>(schema)` modules.

### Upgrading from 0.9

1. Rename the `p` import to `a`, and each `p.` call to `a.`.
2. Run `asterdoc generate` again for generated artifact modules.

From Paradoc 0.8, first do the 0.9 `Upgrading from 0.8` steps with `0.10.0` in place of `0.9.0`, then these steps.

## [0.9.0] - 2026-10-29

Paradoc is now Asterdoc. 0.9 renames the packages, the CLI, the project files and the hosts, and starts a new schema history at `2026-10-28`. The artifact format is the same as in Paradoc 0.8.

### Highlights

- The packages are `@asterdoc/*`. The CLI is `@asterdoc/cli`, or the `asterdoc` package, and the command is `asterdoc`.
- Schemas are at `https://schema.asterdoc.com`. The current version, `2026-10-28`, has the same shape as Paradoc's `2026-10-02`.
- Hosts move from `*.paradoc.dev` to `*.asterdoc.com`. The documentation is at `docs.asterdoc.com` and the public registry is at `public.asterdoc.com`.
- The source is at `github.com/asterdoc/asterdoc`.

### Breaking changes

#### All packages

- Each `@paradoc/*` package is now the `@asterdoc/*` package with the same name. The `@paradoc/*` packages get no more releases.

#### Schemas

- The schema host is `schema.asterdoc.com`, and `SCHEMA_VERSIONS` starts again at `2026-10-28`. The Paradoc versions and their migration steps are removed, so a `schema.paradoc.dev` address reads as `unknown-version`.
- A signature `timestamp` and a lock file `installedAt` must include seconds.

#### CLI

- The command is `asterdoc`, from `@asterdoc/cli` or the `asterdoc` package. It replaces `paradoc` from `@paradoc/cli` or `paradoc-cli`.
- A project uses `asterdoc.json` and `.asterdoc/`, and user settings are in `~/.asterdoc/config.json`.
- Environment variables start with `ASTERDOC_` in place of `PARADOC_`: `ASTERDOC_SCHEMA_URL`, `ASTERDOC_NAMESPACE`, `ASTERDOC_NO_UPDATE_CHECK`, `ASTERDOC_TELEMETRY_DISABLED`, `ASTERDOC_TELEMETRY_URL` and `ASTERDOC_TELEMETRY_DEBUG`.

#### React

- The document root has the class `asterdoc-document` in place of `paradoc-document`.

#### Agent skills

- The skills are `asterdoc` and `asterdoc-react`, from `github.com/asterdoc/asterdoc`.

### Upgrading from 0.8

1. Replace each `@paradoc/*` dependency with the `@asterdoc/*` package of the same name at `0.9.0`, and change the imports.
2. Remove `paradoc-cli` or `@paradoc/cli`, and install the CLI with `npm install -g asterdoc`.
3. In each project, rename `paradoc.json` to `asterdoc.json` and `.paradoc/` to `.asterdoc/`. Move `~/.paradoc/config.json` to `~/.asterdoc/config.json`.
4. Rename each `PARADOC_*` environment variable to `ASTERDOC_*`.
5. If an artifact is older than Paradoc's `2026-10-02`, bring it to `2026-10-02` with `paradoc migrate` from Paradoc 0.8. Then run `asterdoc migrate <files> --from 2026-10-28`. It changes only `$schema`, to `https://schema.asterdoc.com/2026-10-28.json`.
6. Change registry URLs and links from `*.paradoc.dev` to `*.asterdoc.com`, and publish your hosted artifacts again after step 5.
7. Install the agent skills again from `github.com/asterdoc/asterdoc`.

### Other changes

#### CLI

- `undici` and `vite` move to patched releases.

## [0.8.0] - 2026-10-19

Paradoc 0.8 gives registries editions and versions. A registry manifest now lists every release of an artifact with its checksum, and the CLI and AI tools can ask for one edition or version.

### Highlights

- `paradoc add @ns/name[/edition][@version]` installs one release, checks its SHA-256, and records the edition and version in `.paradoc/lock.json`.
- `get_artifact` and registry sources in the AI tools take `edition` and `version`, and the output names the release that was read.
- `paradoc registry compile` builds a registry from `registry.config.json`: one manifest and a folder for each release.

### Breaking changes

#### Registries

- The registry manifest (`registry.json`) lists `currentEdition` and `editions`, or `latestVersion` and `versions`, for each item. `artifactsPath` and the item `path` are removed. Paradoc 0.8 cannot read an older manifest, and 0.7 cannot read a new one.

#### CLI

- `paradoc registry make` writes `registry.config.json` and no longer takes `--artifacts-path`. `registry catalog add`, `catalog remove` and `compile` read that file: `-r, --registry` is now `-c, --config`, and `catalog add` has no `--yes`.
- `paradoc check` takes `tsx` from your project, which halves the CLI install. Without it, the command stops and prints the install line.

#### AI tools

- `fetchRegistryItem`, `fetchRegistryItemResponse` and `buildArtifactItemUrl` are removed.
- The `get_registry` output has no `artifacts_path` or item `path`. Each item lists its editions and versions.

### Upgrading from 0.7

1. If you host a registry, run `paradoc registry make`, add your artifact files to `registry.config.json`, and run `paradoc registry compile`. Host the output in place of the old `registry.json` and `r/` folder, and upgrade its clients to 0.8 at the same time.
2. Replace calls to the removed AI tools registry functions with `fetchRegistryArtifact`.
3. Run `npm install -D tsx` in a project that runs `paradoc check`.

### Other changes

#### Schemas

- New exports resolve a release from a manifest (`resolveRegistryRelease`, `listRegistryReleases`), parse and format registry references, and compare versions by SemVer precedence.
- A lock file entry can record an `edition`.

#### Core

- An empty string no longer satisfies a required field or annex, so fill state keeps it open and validation reports it as missing.

#### CLI

- `paradoc search` shows every edition and version of an artifact.
- A reference to an edition or version the registry does not list fails and names the ones it does list.

## [0.7.1] - 2026-10-08

Paradoc 0.7.1 fixes problems that real models hit with the AI tools. Renders no longer report a blank file as success, registry calls can rely on the configured default registry, and the Mastra adapter passes free-form JSON through intact.

### Highlights

- `render` refuses a form or checklist with no values instead of returning a blank file. Set `blank: true` to render a blank copy on purpose.
- `registry_url` is optional. A call without it uses `defaultRegistryUrl`.
- `get_fill_state` returns typed targets, exported as `FillTarget` and `FillItemState` from every adapter.
- Mastra tools keep `data`, `patch` and `artifact` inputs, so OpenAI models no longer send `null` for them.
- The documentation has separate Docs and Reference tabs, and the AI agents section is rewritten as task guides.

### Other changes

#### AI tools

- `render` with missing, `null` or empty `data` for a form or checklist returns `success: false` with `missing_data`. If you render blank copies, pass `blank: true`.
- A registry call with no `registry_url` and no `defaultRegistryUrl` fails with `missing_registry_url`.
- The `get_fill_state` output schema types `open_required`, `open_optional`, `blocked`, `done`, `candidates` and `next`.

#### Core

- Progressive validation refuses an array for a party role with `max` 1. Pass one party object.

#### Adapters

- `@asterdoc/mastra` creates its tools with `strict: false`.
- `@asterdoc/ai-sdk`, `@asterdoc/mastra` and `@asterdoc/tanstack-ai` export the `FillTarget` and `FillItemState` types.

## [0.7.0] - 2026-10-08

Paradoc 0.7 records who issued a form and which edition an artifact encodes, and lets bundles address registry artifacts by edition and version. It also adds PDF digital-signature helpers and per-overlay fonts to the renderer.

### Highlights

- Artifacts carry an optional `issuer` and `edition` (`key`, `label`, `date`, `effectiveFrom`), and `code` is the form number as the issuer prints it.
- Registry coordinates take the form `@org/repo/name[/edition][@version]`, with helpers to parse and format them.
- `@asterdoc/render/pdf` can prepare, embed and read a PDF digital signature.
- PDF text overlays can each use their own font, and `pdfFontMetrics()` reports whether a font can draw a string and how wide it is.
- `paradoc migrate` moves artifacts to schema `2026-10-02`.

### Breaking changes

#### Schemas and artifacts

- Schema `2026-10-02` removes `releaseDate`. Record the issuer and edition with `issuer` and `edition` instead.
- A registry bundle item's `slug` is only the address `@org/repo/name`. Edition and version move to the new `edition` and `version` fields. Edition keys cannot be `current`, `latest`, `editions`, `tags` or `diff`.
- The hosted `2026-09-24` schemas are removed from `schema.paradoc.dev`. Run `paradoc migrate` to move files to `2026-10-02`.

#### Core and SDK

- The builders drop `.releaseDate()` for `.issuer()` and `.edition()`. `.registry(key, coordinate, include?)` takes a full three-segment coordinate and throws a `TypeError` on any other value.

#### Essentials

- Each form's `spec` has a top-level `issuer` instead of `metadata.issuer`, and `metadata.sourceUrl` is removed.

### Upgrading from 0.6

1. Run `paradoc migrate <file-or-directory> --dry-run`, review the changes, then rerun without `--dry-run`. The step removes `releaseDate` and moves a slug's `@version` into `version`.
2. Correct by hand any registry slug that is not `@org/repo/name[@version]`, such as `@asterdoc/essentials/tax/w-9@1.0.0`. The migration stops on it.
3. Replace `.releaseDate()` with `.issuer()` and `.edition()`, and pass full `@org/repo/name` coordinates to `.registry()`.
4. Read `issuer` from an essentials form's `spec` instead of `spec.metadata.issuer`.

### Other changes

#### Schemas and types

- `@asterdoc/schemas` exports `parseArtifactCoordinate`, `formatArtifactCoordinate`, `ArtifactCoordinateSchema`, the edition and version selector schemas, and the reserved edition keys. `@asterdoc/types` exports `ArtifactEdition`.

#### Core

- `sealBundle` refuses a part whose edition differs from the edition its bundle item declares.

#### Render

- `preparePdfSignature`, `signedBytes`, `embedPdfSignature` and `readPdfSignature` sign a PDF with a container from any signing service.
- A text overlay takes its own `font`, and `pdfFontMetrics(font)` returns `canDraw` and `width`.
- Rendering on a page that an earlier render drew on keeps the earlier fonts and images.

#### CLI

- `paradoc show` prints the issuer and edition, and shows registry bundle items as full coordinates. `paradoc new --code` sets the issuer's form number.
- The CLI sends all telemetry to `telemetry.paradoc.dev`. Public-registry installs send a `directory.installed` event in the same batch, and nothing goes to `tasks.paradoc.dev`. `PARADOC_TELEMETRY_URL` points the CLI at another telemetry origin, such as `https://telemetry-dev.paradoc.dev`.

#### AI tools

- `inspect_artifact` returns the artifact's issuer and edition.

## [0.6.1] - 2026-09-28

Paradoc 0.6.1 tightens prerelease schema distribution and makes the documentation easier for people and agents to discover. It also publishes a reusable service-layer boundary for projects using the Paradoc ESLint configuration.

### Highlights

- `@asterdoc/schemas` now packages only the current dated schema set and live-root schemas, while older prerelease schemas remain available through Git history.
- The documentation publishes a permanent page for each release alongside the latest changelog index.
- Canonical URLs, a generated sitemap, and improved Markdown responses make documentation routes easier for search engines and agents to discover.
- `@asterdoc/eslint-config/service-boundary` enforces API-free service modules by preventing imports from co-located contracts and `@shared/api-kernel`.

### Other changes

#### Documentation

- Public navigation no longer advertises the hosted MCP reference; AI guidance directs developers to the published adapter packages for in-process tools.
- Sidebar and content-grid behavior is more consistent across documentation pages.

## [0.6.0] - 2026-09-25

Paradoc 0.6 turns documents into a complete application surface: compose them in React, migrate versioned artifacts, extract filled PDFs, and seal multi-document packets. It also tightens public contracts across the SDK, CLI, rendering, sessions, and AI adapters.

### Highlights

- Dated schemas and `paradoc migrate` make artifact upgrades explicit, reviewable, and reversible with `--dry-run`.
- React layers, live `paradoc dev` previews, `paradoc check`, and the copyable component registry provide an end-to-end document composition workflow.
- `sealBundle` prepares and seals multi-part packets with one canonical PDF, packet-wide signer mapping, and part-level provenance.
- PDF rendering now embeds fonts, follows AcroForm appearance settings, rejects encrypted inputs, and can extract filled values back into artifact data.
- Templates and artifact logic share `@asterdoc/expr`, including typed conditions, list aggregates, party data, and row-aware expressions.
- `@asterdoc/format` replaces serialization with locale-aware formatting shared by text, DOCX, PDF, and React output.
- AI SDK, TanStack AI, and Mastra adapters expose the same validated document operations, including extraction and progressive filling.

### Breaking changes

#### Schemas and artifacts

- Artifact files must use the current dated `$schema`; run `paradoc migrate` before loading older, undated, or unversioned files.
- Signing fields now live only in `signatures`; migrate legacy `signatureBlocks` and `anchorBlocks` to signature slots.
- Field, party, option, and config schemas reject unknown keys; correct misspellings instead of relying on dropped properties.
- The marker placement literal is `flow`, not `auto`; the migration rewrites existing slots.

#### Core and SDK

- Import the builder namespace as `p` instead of `para`.
- `fill()` and `safeFill()` are progressive; replace partial-fill APIs with `fill()` followed by `update()`.
- Bind file resolvers when constructing or loading an artifact, not in `render()`, `seal()`, or bundle operations.
- Pass a `SealAdapter` through `seal({ adapter })`; the legacy `Sealer` overload and formal-signing aliases are removed.
- Replace `DraftForm.setField()` and `updateFields()` with `draft.update({ fields: ... })`.
- Custom renderers must read `parties`, `annexes`, `signers`, `captures`, and `defs` beside `data.fields`.

#### Rendering and React

- Import PDF runtime APIs from `@asterdoc/react-pdf`; `@asterdoc/react` now contains the headless React runtime and discovery APIs.
- Text and DOCX templates must use full paths such as `{{fields.name}}`; binding aliases are supported only on PDF file layers.
- PDF bindings now fail on missing fields, invalid roots, and malformed qualifiers; use AcroForm field names as keys and Paradoc paths as values.
- Replace legacy template helpers and Handlebars context paths with artifact expressions, `item`, `parent`, and `index(item)`.
- Application styles own typography; remove `fontFamily` tokens and registered package font families.
- Remove PDF signature rendering options and deprecated SDK renderer wrappers; use built-in rendering or `@asterdoc/render` subpaths.

#### CLI, sessions, AI, and resolvers

- The CLI, `@asterdoc/ai-tools`, `@asterdoc/ai-sdk`, and `@asterdoc/tanstack-ai` require Node.js 22 or newer.
- Invoke the CLI as `paradoc`; the `para` binary is removed.
- Configure every registry explicitly; the CLI no longer falls back to a default registry.
- Session projections now include annexes and richer party state; persist events directly instead of using the removed spine adapter.
- Use the unified `@asterdoc/ai-tools` operation contracts and renamed validation outputs.
- Import resolvers from `@asterdoc/resolvers/fs`, `/http`, or `/memory`; the package root exports nothing.
- Replace `@paradoc/serialization` with `@asterdoc/format` and pass a formatter through render context.

### Upgrading from 0.5

1. Upgrade CLI and AI runtimes to Node.js 22 or newer.
2. Run `paradoc migrate <file-or-directory> --dry-run`, review the schema and signature-slot changes, then rerun without `--dry-run`.
3. Rename `para` imports to `p`, bind resolvers when artifacts are constructed, and replace removed draft and fill helpers.
4. Install `@asterdoc/react-pdf` for React PDF rendering, checking, or Chromium output and update imports from `@asterdoc/react`.
5. Replace template binding aliases and helpers, then run `paradoc validate` and `paradoc check` across the migrated project.

### Other changes

#### Core, schemas, and sessions

- Builders cover every schema key, and validation reports schema versions, file references, template expressions, signing slots, and PDF bindings earlier.
- List aggregates, typed party expressions, row references, progressive checklists, annex commands, and rule IDs improve guided form completion.
- Bundle rendering preserves nested parts, while sealing and finalization enforce signer, capture, and required-slot integrity.

#### Render, React, and components

- PDF fill and extraction support embedded fonts, Unicode strings, comb fields, multiline values, overlays, page selection, flattening, and merging.
- React documents add pagination, page furniture, explicit breaks, application fonts, right-to-left output, annex images, and packet previews.
- The `@paradoc` component registry ships document components and complete blocks for invoices, engagement letters, purchase orders, and vendor packets.
- Formatters add selection, rating, contact, temporal, money, party, attachment, and signature output with locale fallbacks and structured issues.

#### CLI, SDK, and AI

- `paradoc migrate`, `data extract`, `dev`, and `check` cover schema upgrades, PDF recovery, live composition previews, and static composition checks.
- CLI validation accepts multiple artifacts, validates project files and data through core, and preserves installed layer dependencies and checksums.
- AI adapters share bounded model output, validated inputs and outputs, fill-state inspection, updates, rendering, and extraction.
- `hostedSealAdapter` uses the served conversion route, supports cancellation, and reports structured conversion and response errors.

#### Packages

- `@asterdoc/react`, `@asterdoc/react-pdf`, `@asterdoc/format`, and `@asterdoc/mastra` join the public framework.
- `@asterdoc/resolvers/http` safely resolves file-backed layers beneath a base URL in any runtime with `fetch`.
- Essentials artifacts and examples use current schemas, signature slots, formatter behavior, and rendering limits.

## [0.5.0] - 2026-08-10

Paradoc 0.5 introduces a single signature-slot model and a dependency-light placement engine for preparing documents before signing.

### Highlights

- Layers declare a unified `signatures` map for marker, anchor, or absolute signature placement.
- `prepareSeal()` returns the exact pre-flatten PDF, resolved fields, provenance, and warnings without changing form state.
- The built-in PDF locator resolves signature markers and anchor text without a PDF rendering engine.
- Pure byte converters such as `hostedSealAdapter` work with anchor-based sealing without extra placement configuration.

### Breaking changes

#### Core and types

- `SealingRequest.options` is removed; stop passing its unused `renderer` or `format` keys.

### Other changes

#### Schemas and render

- Schema version `2026-08-10` adds signature slots while keeping the published `2026-08-06` schemas available.
- `SealOptions.locate` allows a custom placement locator when the built-in PDF locator is not suitable.
- PDF parsing resolves indirect stream lengths, preserving content from PDFs written by LibreOffice.

## [0.4.0] - 2026-08-06

Paradoc 0.4 consolidates rendering into one dependency-light package and makes MIME-selected rendering the default across the framework.

### Highlights

- `@asterdoc/render` renders text, Markdown, HTML, PDF, and DOCX layers through one public package.
- Form rendering and sealing select built-in renderers by MIME type while preserving custom renderer overrides.
- Recursive list fields work across builders, schemas, validation, serialization, and rendering.
- Sealing can flatten PDFs locally and delegate non-PDF conversion through an adapter.

### Breaking changes

#### Render

- Replace `@paradoc/renderers` and the format-specific renderer packages with `@asterdoc/render` and its `/text`, `/pdf`, and `/docx` subpaths.

### Upgrading from 0.3

1. Update renderer imports and remove dependencies on `@paradoc/renderer-text`, `@paradoc/renderer-pdf`, and `@paradoc/renderer-docx`.

### Other changes

#### Schemas

- Schema version `2026-08-06` becomes current while the published `2026-01-01` schemas remain available.
- Rendering and e-signing paths no longer require the previous heavy PDF, DOCX templating, and Handlebars dependency stack.

## [0.3.0] - 2026-06-19

Paradoc 0.3 adds a purpose-built expression language and publishes the deterministic session engine for guided form completion.

### Highlights

- `@asterdoc/expr` provides a typed parser, evaluator, and artifact-aware checker with exact decimal and temporal values.
- `@asterdoc/sessions` provides an event-sourced, storage-agnostic form-completion engine.
- Fill state reports one visibility and requirement status, transitive blockers, and the next field in dependency order.
- The SDK exposes expression APIs through `expr`, including parsing, checking, and `Decimal`.

### Other changes

#### Core

- Artifact logic runs on `@asterdoc/expr`, and hidden fieldsets now hide their full subtree.
- The `expr-eval-fork` dependency is removed.

## [0.2.0] - 2026-05-19

Paradoc 0.2 adds labeled enum choices and source-language metadata across artifacts, schemas, builders, and CLI workflows.

### Highlights

- Enum and multiselect options use `{ value, label? }`, allowing display labels without changing stored values.
- Artifacts can declare a BCP 47 source language through `language`.
- Shared artifact methods expose the artifact `code`.

### Breaking changes

#### Types and schemas

- Replace primitive enum arrays with `EnumOption[]`; multiselect defaults now contain option values rather than option objects.

### Upgrading from 0.1

1. Rewrite enum options as `{ value, label? }` and keep multiselect defaults as the selected primitive values.

### Other changes

#### CLI and schemas

- CLI fill, validation, and template commands understand labeled options.
- Published per-form JSON schemas are regenerated without the stale non-standard `id` property.

## [0.1.1] - 2026-05-08

This patch expands signature blocks and corrects rendering and schema behavior for common field values.

### Highlights

- Signature blocks support `capacity` and `printed_name`, with matching text and PDF helpers.
- PDF rendering handles multiselect arrays in qualified checkbox bindings.
- Address-region schema and rendering behavior are corrected.

### Other changes

#### Packages

- All public packages remain on the same 0.1.1 lockstep version.

## [0.1.0] - 2026-04-28

The first public Paradoc release establishes documents as typed, machine-readable artifacts for applications and AI agents.

### Highlights

- Typed builders define forms, documents, checklists, bundles, parties, fields, annexes, and output layers.
- Core validation checks artifact definitions and filled data against shared Zod and JSON Schema contracts.
- Text, PDF, and DOCX renderers produce multiple outputs from the same artifact definition.
- `@asterdoc/sdk` provides the all-in-one framework entry point, with CLI and AI adapter packages alongside it.
- The published packages support Node.js 18 and are released in lockstep under the MIT license.
