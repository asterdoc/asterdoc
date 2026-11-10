---
name: formatting
description: Locale-aware presentation of artifact values with @asterdoc/format. Passing a formatter to render, constructor options, lookup providers, every format method, safe results, selection values, address layouts, and the format an artifact declares on layers, bindings, placeholders and elements.
metadata:
  tags: formatting, locale, money, date, phone, country, region, mask, address, enum, rating, formatter, providers, render, format
---

# Formatting

**Contents:** [Format a render](#format-a-render) · [Create a formatter](#create-a-formatter) · [Lookup providers](#lookup-providers) · [Artifact formats](#artifact-formats) · [Methods](#methods) · [Safe results](#safe-results) · [Value rules](#value-rules) · [Selection values](#selection-values) · [Addresses](#addresses) · [Specialize a formatter](#specialize-a-formatter)

`@asterdoc/format` turns stored values into display text; stored values stay as they are. `@asterdoc/sdk` re-exports all of it.

Two levels choose the presentation. The caller passes a formatter: locale, time zone, options per kind. The artifact declares a `format` only where its template needs one, such as a PDF box that wants `MM/DD/YYYY` ([Artifact formats](#artifact-formats)).

## Format a render

Pass the formatter to `render()`. Every value in the layer prints with it.

```typescript
import { createFormatter, a } from "@asterdoc/sdk";

const invoice = a.form({
  name: "invoice",
  fields: { total: { type: "money" }, due: { type: "date" } },
  layers: { text: { kind: "inline", mimeType: "text/plain", text: "Total: {{fields.total}}, due {{fields.due}}" } },
});

const formatter = createFormatter({ locale: "de-DE" });
const draft = invoice.fill({ fields: { total: { amount: 1500.5, currency: "EUR" } } });

await draft.render({ layer: "text", formatter });
// "Total: 1.500,50 €, due "
```

Other render options, such as `progressive` for missing values, are in [rendering.md § Render options](./rendering.md#render-options).

## Create a formatter

`createFormatter(options)` returns an immutable formatter. With no options it prints `en-US`, UTC, Gregorian, and has no [lookup providers](#lookup-providers). `defaultFormatter` from `@asterdoc/format` is that formatter. `defaultFormatter` from `@asterdoc/sdk` or `@asterdoc/render` adds both providers, and is what a render uses when you pass none.

| Option | Default | Description |
|--------|---------|-------------|
| `locale` | `"en-US"` | BCP 47 locale, such as `de-DE` |
| `unsupportedLocale` | `"error"` | `"error"` throws `FormatConfigurationError` at construction for a locale the runtime lacks. `"fallback"` uses `fallbackLocale`. |
| `fallbackLocale` | none | Locale for an unsupported runtime locale, and for package messages a supported locale lacks |
| `timeZone` | `"UTC"` | Time zone for instants (datetimes) |
| `calendar` | `"gregory"` | Calendar for dates and datetimes |
| `numberingSystem` | the locale's | Digits for numbers and dates, such as `arab` |
| `money`, `number`, `percentage`, `date`, `datetime`, `time`, `duration`, `address`, `phone`, `party`, `boolean`, `enum`, `multiselect`, `rating`, ... | none | Base options for each value kind, the same objects the methods take |
| `providers` | none | `{ phone?, regions? }`: lookup data some formats need ([Lookup providers](#lookup-providers)) |
| `overrides` | none | Replacement implementations per kind; see [Specialize a formatter](#specialize-a-formatter) |
| `messages` | none | Extra package messages keyed by locale |

Use a precise locale. The built-in messages cover `en-US`, `en-GB`, `de-DE`, `fr-FR` and `ar-SA`. A region label such as `EU` is not a policy: Intl reads `EU` as Basque.

## Lookup providers

Some formats need data the lean `@asterdoc/format` root leaves out. Add it with `providers`:

| Provider | Import | Needed for |
|----------|--------|------------|
| `phoneProvider` | `@asterdoc/format/phone` | Phone `style` other than `e164`, and phone parts |
| `regionsProvider` | `@asterdoc/format/regions` | `region` display, and `country` display of a value stored as a name. Subdivision names are English only |

```typescript
import { createFormatter, phoneProvider, regionsProvider } from "@asterdoc/sdk";

const formatter = createFormatter({ locale: "en-GB", providers: { phone: phoneProvider, regions: regionsProvider } });
```

A render without a formatter uses the SDK's `defaultFormatter`, which has both. A formatter you create has none until you add them: a layer with `"phone": { "style": "national" }` then fails with `missing_format_provider` (`Phone style "national" needs the phone provider`). `compose()` keeps a formatter's providers. In a browser, `@asterdoc/react` prints with the lean default; see the `asterdoc-react` skill.

## Artifact formats

`format` says how values print where a template needs it. It goes in four places:

| Where | Shape | Reference |
|-------|-------|-----------|
| A layer that prints values: PDF, text, Markdown, HTML, DOCX, React; file or inline | `"format": { ... }` | [layers.md § Layer shape](./layers.md#layer-shape) |
| One PDF binding | `{ "path": "dob", "format": { ... }, "part"?: "year" }` | [pdf.md § Binding objects](./pdf.md#binding-objects) |
| One template placeholder | `{{ fields.dob \| date.pattern="MM/DD/YYYY" }}` | [templates.md § Format modifiers](./templates.md#format-modifiers) |
| One React element | `format` on `Field`, `Party`, `Table`, `Totals` and the hooks | the `asterdoc-react` skill |

Every key is optional:

| Key | Values | Effect |
|-----|--------|--------|
| `locale` | BCP 47 tag, such as `en-US` | Names and words in this locale |
| `case` | `"upper"`, `"none"` | `upper` prints in upper case, last, after any join. On a layer it skips email, uri and uuid fields. `none` turns off an `upper` set below |
| `money` | `{ currencyDisplay?: "none", fractionDigits?: 0 \| 2, useGrouping?: boolean }` | No symbol, for a box that pre-prints it. Exactly 0 or 2 digits, rounding half away from zero (`1.999` prints `2`). No grouping separators |
| `date` | `{ pattern: "MM/DD/YYYY" \| "DD/MM/YYYY" \| "YYYY-MM-DD" }` | Dates in that numeric order |
| `phone` | `{ style?: "e164" \| "international" \| "national" \| "digits", region?: "US" }` | `+12125551234`, `+1 212 555 1234`, `(212) 555-1234`, `2125551234`. `region` names the plan a national box expects: under `national` and `digits` a number from another plan is refused |
| `choice` | `{ display?: "label" \| "value" }` | What `enum` and `multiselect` print in text |
| `boolean` | `{ trueLabel?, falseLabel? }` | The words for true and false in text |
| `country` | `{ display: "code" \| "name" }` | `CA` or `Canada`, for a `country` field and an address `country` |
| `region` | `{ display: "code" \| "name" \| "full" }` | `ON`, `Ontario` or `CA-ON`, for a `region` field and an address `region` |
| `person` | `{ order?: "given-first" \| "family-first" }` | `family-first` prints "Lovelace, Ada", without the title. A person with only `name` prints `name` |
| `text` | `{ mask?: boolean }` | Whether masked `text` fields print through their mask. Default `true`. A binding or placeholder may also name a mask string |

Checkboxes, radio buttons and dropdowns always take raw values: `choice`, `boolean` and `case` never change them. Without `country` or `region`, the value prints as stored.

Levels merge from lowest to highest, per kind and per property: the caller's formatter, then the layer's `format`, then the binding's, placeholder's or element's. A binding's `money: { useGrouping: false }` keeps the layer's `currencyDisplay`, and a higher `locale` replaces a lower one.

```json schema=form
{
  "fields": { "dob": { "type": "date" }, "fee": { "type": "money", "currency": "USD" } },
  "layers": {
    "summary": {
      "kind": "inline",
      "mimeType": "text/plain",
      "format": { "date": { "pattern": "MM/DD/YYYY" }, "money": { "fractionDigits": 0 } },
      "text": "Born {{fields.dob}}. Fee {{fields.fee}}. Filed as {{ fields.dob | date.pattern=\"YYYY-MM-DD\" }}."
    }
  }
}
```

With `dob` `1990-06-15` and a fee of 1250.5 USD, it prints `Born 06/15/1990. Fee $1,251. Filed as 1990-06-15.`

An artifact that declares no `format`, binding object, modifier or mask prints as it did before these options existed.

## Methods

Each value kind has a strict method and a safe method. The strict one returns text or throws `FormatError`. The safe one returns a [result](#safe-results).

| Kind | Strict | Safe | Options |
|------|--------|------|---------|
| number | `formatNumber` | `safeFormatNumber` | Intl number options |
| money | `formatMoney` | `safeFormatMoney` | Intl number options, `currencyDisplay` (including `"none"`), `currencySign`, `fractionDigits` |
| percentage | `formatPercentage` | `safeFormatPercentage` | Intl number options |
| date | `formatDate` | `safeFormatDate` | Intl date options, `timeZone`, `calendar` |
| datetime | `formatDatetime` | `safeFormatDatetime` | Same |
| time | `formatTime` | `safeFormatTime` | Same |
| duration | `formatDuration` | `safeFormatDuration` | Intl number options |
| address | `formatAddress` | `safeFormatAddress` | `layout`, `countryLayouts` |
| phone | `formatPhone` | `safeFormatPhone` | `extensionLabel`, `style`, `region` |
| person | `formatPerson` | `safeFormatPerson` | `order` |
| organization | `formatOrganization` | `safeFormatOrganization` | none |
| party | `formatParty` | `safeFormatParty` | `partyType` for a party with only `name` |
| coordinate | `formatCoordinate` | `safeFormatCoordinate` | Intl number options |
| bbox | `formatBbox` | `safeFormatBbox` | Intl number options |
| identification | `formatIdentification` | `safeFormatIdentification` | Intl date options |
| attachment | `formatAttachment` | `safeFormatAttachment` | none |
| signature | `formatSignature` | `safeFormatSignature` | Intl date options |
| boolean | `formatBoolean` | `safeFormatBoolean` | `trueLabel`, `falseLabel` |
| enum | `formatEnum` | `safeFormatEnum` | `options`, `unknownOption` |
| multiselect | `formatMultiselect` | `safeFormatMultiselect` | `options`, `unknownOption`, `listType`, `listStyle` |
| rating | `formatRating` | `safeFormatRating` | `max`, `display` |

Every method also takes a per-call `locale` and `numberingSystem`. For a kind known only at runtime, call `formatter.format(kind, value)` or `formatter.safeFormat(kind, value)`. The standalone `formatValue(kind, value)` and `safeFormatValue(kind, value)` use `defaultFormatter`, as do the standalone exports named after each method.

## Safe results

```typescript
formatter.safeFormatMoney({ amount: 10 });
// { success: false, status: "incomplete",
//   issues: [{ code: "missing_member", path: "currency", kind: "money",
//              message: "Money currency is required; no default currency is applied." }] }
```

| `status` | `success` | Meaning |
|----------|-----------|---------|
| `formatted` | `true` | `value` holds the text |
| `missing` | `false` | No value |
| `incomplete` | `false` | A composite lacks a required member |
| `invalid` | `false` | The value or an option is wrong, such as `2026-13-01`, an enum value no option declares, or `timeZone: "Nope/Zone"` (code `invalid_options`) |
| `unsupported` | `false` | The input is fine but cannot print this way: a rating with no `max`, a missing package message, a locale the runtime lacks (`unsupported_locale`) |
| `error` | `false` | An unexpected failure |

A failed result carries `issues`: `{ code, message, path?, kind?, cause? }`.

## Value rules

The stored shape of each value is in [fields.md](./fields.md).

| Kind | Rule |
|------|------|
| money | Always carries its currency. A bare amount gets no default currency. |
| percentage | Percentage points: `8.25` prints as `8.25%`. |
| date | A calendar date. The time zone never shifts it. |
| datetime | A value with `Z` or an offset is an instant, printed in `timeZone`. |
| time | A clock value. The host time zone never changes it. |
| duration | ISO 8601. Zero components are left out. |

## Selection values

Pass what the field declares: its `enum` options, its rating `max`.

```typescript
const services = [
  { value: "plumbing", label: "Plumbing" },
  { value: "wiring", label: "Wiring" },
];

formatter.formatBoolean(true); // "Ja" (de-DE)
formatter.formatEnum("wiring", { options: services }); // "Wiring"
formatter.formatMultiselect(["plumbing", "wiring"], { options: services }); // "Plumbing und Wiring"
formatter.formatRating(4, { max: 5 }); // "4 von 5"
```

| Option | Values | Effect |
|--------|--------|--------|
| `trueLabel`, `falseLabel` | string | Replace the locale's yes and no words |
| `unknownOption` | `"error"` (default), `"value"` | A value no option declares is `invalid`, or prints as itself |
| `listType` | `"conjunction"` (default), `"disjunction"`, `"unit"` | "and", "or", or a plain unit list |
| `listStyle` | `"long"` (default), `"short"`, `"narrow"` | Verbosity of the joiner |
| `max` | number | The rating scale. Without it the rating is `unsupported`. |
| `display` | `"scale"` (default), `"value"` | "4 of 5", or "4" |

Renderers pass a field's options and `max` for you. A rating field without `max` renders as a plain number.

## Addresses

Country layouts exist for `US`, `GB`, `DE`, `FR` and `SA`. Another country is `unsupported` unless you choose a layout:

```typescript
const tokyo = { line1: "1-1 Chiyoda", locality: "Tokyo", region: "Tokyo", postalCode: "100-0001", country: "JP" };

formatter.safeFormatAddress(tokyo).status; // "unsupported"
formatter.formatAddress(tokyo, { layout: "generic" }); // "1-1 Chiyoda, Tokyo, Tokyo, 100-0001, JP"
```

`countryLayouts` maps an ISO 3166-1 alpha-2 code to your own `(address, context) => string`. The address country is independent of the formatter locale.

## Specialize a formatter

`compose(options)` and `withOverrides(overrides)` return a new formatter. The original is unchanged.

```typescript
const amountOnly = formatter.compose({ money: { currencyDisplay: "none" } });
amountOnly.formatMoney({ amount: 12000, currency: "USD" }); // "12.000,00"

const tagged = formatter.withOverrides({
  money: (value, options, context) => `${context.delegate(value, options)} (net)`,
});
tagged.formatMoney({ amount: 1, currency: "EUR" }); // "1,00 € (net)"
```

`currencyDisplay: "none"` keeps the currency's fraction digits (two for USD, none for JPY) unless you set digits. An override calls `context.delegate` to reach the implementation it replaces.

A kind that formats through another kind, such as a signature's date or a rating's number, passes only its own options: `number: { maximumFractionDigits: 0 }` does not round a rating. An override of the inner kind still applies.
