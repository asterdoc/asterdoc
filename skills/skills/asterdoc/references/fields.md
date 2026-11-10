---
name: fields
description: The 26 Asterdoc field types. Properties per type, the exact fill value per type, masks, sensitive values, how country and region input is converted, SDK builders, and how to choose a type.
metadata:
  tags: fields, types, fill values, constraints, mask, sensitive, country, region, fieldset, list, enum, money, phone, datetime, builders
---

# Fields

**Contents:** [Common properties](#common-properties) · [Field Type Reference](#field-type-reference) · [Type-specific properties](#type-specific-properties) · [Sensitive values](#sensitive-values) · [Input refusals](#input-refusals) · [Design heuristics](#design-heuristics) · [SDK](#sdk) · [Add a field](#add-a-field)

A form's `fields` object maps each field id to a field definition. Field ids, nested ones included, are camelCase ([schemas.md § Identifier patterns](./schemas.md#identifier-patterns)). For `required` and `visible` expressions, load [logic.md](./logic.md).

## Common properties

Every field type takes `type` plus these optional properties, along with the properties its type lists below.

| Property | Type | Constraint |
|----------|------|------------|
| `type` | string | Required. One of the types in the table below. |
| `label` | string | 1-200 characters |
| `description` | string | 1-1000 characters |
| `required` | CondExpr | `true`, `false`, or a boolean expression string. Default: not required. |
| `visible` | CondExpr | Same. A hidden field is never required. |
| `sensitive` | boolean | Redact the value in explanations and errors. See [Sensitive values](#sensitive-values). |

`default` is not common. Each type that accepts one lists it, and `fieldset` and `list` accept none.

## Field Type Reference

Asterdoc has 26 field types. The fill value column is the exact JSON a payload carries under `fields.<id>`.

| Type | Fill value | Use for |
|------|-----------|---------|
| `text` | string | Free text, names, notes |
| `boolean` | `true` or `false` | Yes/no, one checkbox |
| `number` | number | Counts, quantities |
| `money` | `{ "amount": 1500.5, "currency": "USD" }` | Prices, fees, salaries |
| `percentage` | number in percentage points (`8.25` is 8.25%) | Rates, ratios |
| `rating` | number | Scores |
| `date` | `"2026-01-31"` (`YYYY-MM-DD`) | Calendar dates |
| `datetime` | `"2026-01-31T14:30:00Z"` or `"2026-01-31T14:30:00+02:00"` | Timestamps |
| `time` | `"14:30:00"` or `"14:30:00.5"` (`HH:MM:SS[.fff]`, 24-hour) | Times of day |
| `duration` | `"P1Y"`, `"PT30M"` (ISO 8601) | Lease terms, warranties |
| `email` | `"jane@example.com"` | Email addresses |
| `phone` | `{ "number": "+14155552671", "type"?: "mobile", "extension"?: "12" }` | Phone numbers |
| `address` | `{ "line1", "line2"?, "locality", "region", "postalCode", "country" }` | Postal addresses |
| `country` | `"CA"` (ISO 3166-1 alpha-2); input also takes `"CAN"` or `"Canada"` | Countries |
| `region` | `"CA-ON"` (ISO 3166-2); input also takes `"Ontario"`, or `"ON"` when `country` is set | States, provinces |
| `person` | `{ "name", "title"?, "firstName"?, "middleName"?, "lastName"?, "suffix"? }` | People |
| `organization` | `{ "name", "legalName"?, "domicile"?, "entityType"?, "entityId"?, "taxId"? }` | Companies |
| `identification` | `{ "type", "number", "issuer"?, "issueDate"?, "expiryDate"? }` | Passports, licenses, tax ids |
| `uuid` | `"123e4567-e89b-12d3-a456-426614174000"` | Unique identifiers |
| `uri` | `"https://example.com"` (absolute URL) | Links |
| `enum` | one option `value`, same JSON type (`2`, not `"2"`) | Single choice |
| `multiselect` | array of distinct option values | Multiple choice |
| `coordinate` | `{ "lat": 40.71, "lon": -74.0 }` | GPS points |
| `bbox` | `{ "southWest": { "lat", "lon" }, "northEast": { "lat", "lon" } }` | Geographic boxes |
| `fieldset` | object keyed by the nested field ids | Grouped sub-fields |
| `list` | array of `item` values | Repeating entries |

Object values are strict too: `{ "number": "+14155552671", "ext": "12" }` fails with `Unknown field(s): ext`; use `extension` instead.

## Type-specific properties

Each section lists the properties a type adds to the common ones, its fill value rules, and one example. `min` must be at most `max`, `minLength` at most `maxLength`, and `minItems` at most `maxItems`. Validation reports `max must be greater than or equal to min`.

#### text, uuid, uri

| Property | Type | Description |
|----------|------|-------------|
| `minLength` | integer >= 0 | Minimum length |
| `maxLength` | integer >= 0 | Maximum length |
| `pattern` | string | Regular expression, 1-500 characters. A pattern that does not compile, or is open to catastrophic backtracking, is refused. |
| `mask` | string | `text` only. Input mask; see [Text masks](#text-masks) |
| `default` | string | Default value |

A `uuid` value must be a UUID. A `uri` value must be an absolute URL (`x.co` fails with `Invalid URL format`).

```json schema=fields
"fullName": { "type": "text", "label": "Full legal name", "required": true, "minLength": 2, "maxLength": 100 },
"ssn": { "type": "text", "label": "SSN", "mask": "###-##-####", "sensitive": true }
```

##### Text masks

A `mask` fixes the shape of a formatted identifier. `#` is a digit, `@` a letter, `*` a digit or letter, and `\` makes the next character a literal. Every other character is a literal.

- The stored value holds only the token characters: `"123-45-6789"` and `"123456789"` both store `123456789`. Letters keep their case.
- Input that puts literals in the wrong places (`"123 45 6789"`) is refused with code `mask_mismatch`. A draft accepts a value that is the start of one (`"12345"`); `validate()` reports it until it fills the mask.
- `pattern`, `minLength` and `maxLength` apply to the stored value.
- Renders print through the mask by default (`123-45-6789`). A layer, binding or placeholder can print it without the mask or with another one ([formatting.md § Artifact formats](./formatting.md#artifact-formats)). A PDF split binding `ssn:2` prints the second group (`45`).
- A mask is not a sensitivity signal. Set `sensitive` too when the value is private.

#### email

| Property | Type | Description |
|----------|------|-------------|
| `minLength` | integer >= 0 | Minimum length |
| `maxLength` | integer >= 0 | Maximum length |
| `default` | string | Default value |

The type checks the address format itself, so email takes no `pattern`.

#### boolean

| Property | Type | Description |
|----------|------|-------------|
| `default` | boolean | Default value |

```json schema=fields
"agreeToTerms": { "type": "boolean", "label": "I agree to the terms", "required": true, "default": false }
```

#### number

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Minimum value |
| `max` | number | Maximum value |
| `step` | number > 0 | A value must be a multiple of it. `0.01` allows cents; `1.234` then fails. |
| `default` | number | Default value |

#### money

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Minimum `amount` |
| `max` | number | Maximum `amount` |
| `currency` | string | ISO 4217 code (`^[A-Z]{3}$`) every value must use. Omit to accept any currency. |
| `default` | `{ amount, currency }` | Default value |

`amount` is a JSON number (`"10"` fails). With `currency: "USD"`, `{ "amount": 10, "currency": "EUR" }` fails with `expected USD`. Expressions read `fields.x.amount` ([logic.md § Money](./logic.md#money)).

```json schema=fields
"monthlyRent": { "type": "money", "label": "Monthly rent", "required": true, "min": 0, "currency": "USD" }
```

#### percentage

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Minimum value |
| `max` | number | Maximum value |
| `precision` | integer >= 0 | Descriptive only. Fill and render do not use it. |
| `default` | number | Default value |

A percentage has no implied range: without bounds, `150` is accepted. Set `min: 0` and `max: 100` when the value is a share of a whole.

```json schema=fields
"interestRate": { "type": "percentage", "label": "Interest rate", "min": 0, "max": 100 }
```

#### rating

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Minimum value |
| `max` | number | Maximum value. Also the scale the formatter prints ("4 of 5"). |
| `step` | number > 0 | A value must be a multiple of it (`0.5` for half stars) |
| `default` | number | Default value |

A rating has no implied range. Set `min` and `max`; without `max` a rendered rating prints as a plain number.

```json schema=fields
"satisfaction": { "type": "rating", "label": "Satisfaction", "min": 1, "max": 5, "step": 1 }
```

#### date, datetime, time

| Property | Type | Description |
|----------|------|-------------|
| `min` | string | Earliest value, same format as the fill value |
| `max` | string | Latest value, same format as the fill value |
| `default` | string | Default value |

| Type | Accepted | Refused |
|------|----------|---------|
| `date` | `2026-01-31` | `2026-1-31` |
| `datetime` | `2026-01-31T14:30:00Z`, `2026-01-31T14:30:00.123+02:00` | `2026-01-31T14:30:00` (`Invalid ISO datetime`) |
| `time` | `14:30:00`, `14:30:00.5` | `14:30`, `24:00:00` |

Include the local offset or convert a local datetime to UTC before you fill it.

```json schema=fields
"dateOfBirth": { "type": "date", "label": "Date of birth", "required": true, "max": "2008-01-01" },
"appointment": { "type": "datetime", "label": "Appointment", "min": "2026-01-01T00:00:00Z" }
```

#### duration

| Property | Type | Description |
|----------|------|-------------|
| `default` | string | Default value |

The value is `P[n]Y[n]M[n]W[n]DT[n]H[n]M[n]S` with at least one component: `P1Y`, `P2W`, `P1DT12H`, `PT30M`. `P` alone fails.

#### enum

| Property | Type | Description |
|----------|------|-------------|
| `enum` | `{ value: string \| number, label?: string }[]` | Required. At least one option, each with a distinct `value`. `label` is 1-200 characters. |
| `default` | string or number | Must equal one option's `value` |

Fill with the option's `value`, not its label. The JSON type must match: with `{ "value": 2 }`, `"2"` fails.

```json schema=fields
"employmentStatus": {
  "type": "enum",
  "label": "Employment status",
  "required": true,
  "enum": [
    { "value": "employed", "label": "Employed" },
    { "value": "self_employed", "label": "Self-employed" },
    { "value": "retired", "label": "Retired" }
  ]
}
```

#### multiselect

| Property | Type | Description |
|----------|------|-------------|
| `enum` | `{ value, label? }[]` | Required. At least one option, each with a distinct `value`. |
| `min` | integer >= 0 | Minimum number of selections |
| `max` | integer >= 0 | Maximum number of selections |
| `default` | `(string \| number)[]` | Each value must equal one option's `value` |

Fill with an array of option values. Duplicates fail with `Array items must be unique`.

```json schema=fields
"services": {
  "type": "multiselect",
  "label": "Services",
  "min": 1,
  "enum": [{ "value": "plumbing", "label": "Plumbing" }, { "value": "wiring", "label": "Wiring" }]
}
```

#### phone

| Property | Type | Description |
|----------|------|-------------|
| `default` | phone object | Default value |

`number` is E.164: `+`, country code, subscriber number, no spaces (`^\+[1-9]\d{1,14}$`). `"555-1234"` fails. `type` is optional free text up to 50 characters, and `extension` is an optional string.

#### address

| Property | Type | Description |
|----------|------|-------------|
| `codes` | boolean | Store `country` as an ISO 3166-1 alpha-2 code and `region` as the ISO 3166-2 code after the dash (`ON`). Names and other codes are converted on input |
| `default` | address object | Default value |

`line1`, `locality`, `region`, `postalCode` and `country` are required; `line2` is optional. `country` is an ISO 3166-1 code (`US`, `GB`) or a country name; with `codes: true` it is stored as the alpha-2 code, and `region` as the code after the dash. In a country with no subdivision codes (`VA`), a region that is not a full code is stored as given. Every address value, including a `default`, requires `postalCode` to contain 3-20 characters of `A-Z`, digits, spaces and hyphens.

```json schema=fields
"propertyAddress": {
  "type": "address",
  "label": "Property address",
  "default": { "line1": "10 Main St", "locality": "Springfield", "region": "IL", "postalCode": "62701", "country": "US" }
}
```

#### country, region

| Property | Type | Description |
|----------|------|-------------|
| `country` | ISO 3166-1 alpha-2 code | `region` only. The country the subdivision must belong to: `"US"` for a US state. Omit to allow any |
| `default` | code string | Default value: `"CA"` for `country`, `"CA-ON"` for `region` |

A `country` value is stored as the alpha-2 code; a `region` value as the full ISO 3166-2 code. Input takes a code or a name: `"Canada"` and `"CAN"` store `CA`; `"Ohio"` stores `US-OH` under `country: "US"`. An input that names no place, or more than one (`"Georgia"`), is refused with candidates to choose from ([Input refusals](#input-refusals)). Use `region` with `country` instead of a copied list of states. The default formatter prints the stored code; a layer's `country` and `region` formats print names.

```json schema=fields
"stateOfBirth": {
  "type": "region",
  "label": "State of birth",
  "country": "US"
}
```

#### person, organization

| Property | Type | Description |
|----------|------|-------------|
| `default` | person or organization object | Default value |

`name` is required on both. A person also takes `title`, `firstName`, `middleName`, `lastName` and `suffix`. An organization also takes `legalName`, `domicile`, `entityType`, `entityId` and `taxId`; its `taxId` and `entityId` are sensitive unless the field sets `sensitive: false`. For the people who sign, use a party role instead; see [parties.md](./parties.md).

#### identification

| Property | Type | Description |
|----------|------|-------------|
| `allowedTypes` | string[] | The values the fill value's `type` may take |
| `default` | identification object | Default value |

`type` and `number` are required. `issueDate` and `expiryDate` are `YYYY-MM-DD`. With `allowedTypes: ["passport"]`, `{ "type": "ssn", ... }` fails with `Must be one of: passport`. An identification field is sensitive unless it sets `sensitive: false`.

```json schema=fields
"governmentId": { "type": "identification", "label": "Government ID", "allowedTypes": ["passport", "drivers_license"] }
```

#### coordinate, bbox

| Property | Type | Description |
|----------|------|-------------|
| `default` | coordinate or bbox object | Default value |

`lat` is -90 to 90 and `lon` is -180 to 180, in decimal degrees. A bbox has `southWest` (minimum) and `northEast` (maximum) corners.

#### fieldset

| Property | Type | Description |
|----------|------|-------------|
| `fields` | object | Required. Nested field definitions, any type, including `fieldset` and `list`. |

The fill value is an object keyed by the declared nested ids. Group three or more closely related fields that render under one heading (a previous address, an emergency contact); keep one or two unrelated fields flat.

```json schema=fields
"emergencyContact": {
  "type": "fieldset",
  "label": "Emergency contact",
  "fields": {
    "name": { "type": "text", "label": "Name", "required": true },
    "relationship": { "type": "text", "label": "Relationship" },
    "phone": { "type": "phone", "label": "Phone", "required": true }
  }
}
```

Fill value: `{ "emergencyContact": { "name": "Ann Lee", "phone": { "number": "+14155552671" } } }`.

#### list

| Property | Type | Description |
|----------|------|-------------|
| `item` | field | Required. The definition of each entry, any type. |
| `minItems` | integer ≥ 0 | Minimum entries |
| `maxItems` | integer ≥ 0 | Maximum entries |

The fill value is an array of `item` values. To total or test rows in an expression, load [logic.md § List aggregates](./logic.md#list-aggregates).

```json schema=fields
"dependents": {
  "type": "list",
  "label": "Dependents",
  "maxItems": 4,
  "item": {
    "type": "fieldset",
    "fields": {
      "name": { "type": "text", "label": "Name", "required": true },
      "dateOfBirth": { "type": "date", "label": "Date of birth" }
    }
  }
}
```

Fill value: `{ "dependents": [{ "name": "Kim", "dateOfBirth": "2019-04-02" }] }`.

## Sensitive values

Mark an account, tax or identity number `sensitive: true`. Identification fields, and the `taxId` and `entityId` of organization fields and parties, are sensitive by default; `sensitive: false` turns that off for a field (not for a party: a party's `taxId` and `entityId` are always sensitive). A value under a sensitive fieldset or list is sensitive too.

Rule explanations, validation and render errors, and AI tool errors print a sensitive value as its kind and length, never the value:

```text
[redacted] (string, length 9)
```

An expression error over a sensitive value drops its text ([logic.md § Missing and failed values](./logic.md#missing-and-failed-values)). `validate({ explain: { raw: true } })` prints raw values for your own debugging; never pass it where the output is logged or shown to a model. Redaction does not touch stored data: session event logs and rendered output hold the real value.

## Input refusals

A value the engine converts before it stores it is refused with a `code` and, for places, `candidates: { code, name }[]`:

| `code` | When |
|--------|------|
| `unknown_country` | No country matches. `candidates` lists the nearest names |
| `ambiguous_country` | The name is a country and a subdivision elsewhere (`"Georgia"`: `GE`, `US-GA`) |
| `unknown_region` | No subdivision matches, or none of the field's `country` |
| `ambiguous_region` | More than one subdivision matches |
| `needs_country` | An address with `codes: true` has a region and no country |
| `mask_mismatch` | The input does not fit the field's mask |

`fill()`, `update()` and `validateFieldInput()` report them in `errors[]`, `{ field, message, code, candidates }`. Show the person the candidate names, ask which one they mean, then answer with its code. A refusal of a sensitive field names its value as `[redacted]` and lists no candidates. For an agent, see [filling.md § Conversational input](./filling.md#conversational-input).

## Design heuristics

### Type selection table

| Data | Use | Not |
|------|-----|-----|
| Prices, fees, rent, salaries | `money` | `number`, `text` |
| Calendar dates | `date` | `text` |
| Date and time of an event | `datetime` | `text` |
| Time of day | `time` | `text` |
| Periods (lease term, warranty) | `duration` | `text`, `number` |
| Yes/no, one checkbox | `boolean` | `enum`, `text` |
| One choice from a list | `enum` | `text` |
| Several choices from a list | `multiselect` | `text` |
| Counts, quantities | `number` | `text` |
| Rates, ratios | `percentage` | `number` |
| Scores | `rating` | `number` |
| Email addresses | `email` | `text` |
| Phone numbers | `phone` | `text` |
| Postal addresses | `address` | `text`, several `text` fields |
| Countries | `country` | `text`, an `enum` of countries |
| States, provinces | `region` | `text`, an `enum` of states |
| A person's name parts | `person` | `text` |
| Company details | `organization` | `text` |
| Passports, licenses, SSN, EIN | `identification`, or `text` with a mask, marked sensitive | bare `text` |
| URLs | `uri` | `text` |
| System identifiers | `uuid` | `text` |
| GPS points | `coordinate` | `text` |
| Geographic areas | `bbox` | `text` |
| Related sub-fields under one heading | `fieldset` | several top-level fields |
| Repeating rows (dependents, line items) | `list` | numbered fields (`child1`, `child2`) |
| Free prose, notes, odd reference numbers | `text` | none |

### Naming by domain

| Domain | Example ids |
|--------|-------------|
| Personal | `firstName`, `lastName`, `dateOfBirth`, `email`, `phone` |
| Financial | `annualIncome`, `monthlyExpenses`, `loanAmount` |
| Employment | `employerName`, `jobTitle`, `startDate`, `annualSalary` |
| Property | `propertyAddress`, `monthlyRent`, `securityDeposit`, `leaseStartDate` |
| Medical | `primaryPhysician`, `allergies`, `medications`, `insuranceProvider` |

Name the thing, not the kind: `monthlyRent`, not `amount`; `leaseStartDate`, not `date`.

### Masks and patterns for common identifiers

| Identifier | Mask | Pattern, without a mask |
|------------|------|-------------------------|
| SSN | `###-##-####` | `^[0-9]{3}-?[0-9]{2}-?[0-9]{4}$` |
| EIN | `##-#######` | `^[0-9]{2}-?[0-9]{7}$` |
| US ZIP | none | `^[0-9]{5}(-[0-9]{4})?$` |

Prefer a mask for a fixed-shape identifier: input is accepted with or without separators and prints formatted. Add a check-digit rule where the identifier has one ([logic.md § Check digits](./logic.md#check-digits)).

### Order and progressive disclosure

Fields render in definition order: identity, contact, domain data, conditional fields, consent. Gate a follow-up field on a boolean condition:

```json schema=fields
"hasPets": { "type": "boolean", "label": "Do you have pets?", "default": false },
"petCount": {
  "type": "number",
  "label": "Number of pets",
  "visible": "fields.hasPets == true",
  "required": "fields.hasPets == true",
  "min": 1,
  "max": 10
}
```

## SDK

The builder chain takes field builders, plain objects, or a mix, and validates each field at `build()`. `a.form({ ... })` takes plain objects only ([sdk.md § Define an artifact](./sdk.md#define-an-artifact)).

```typescript
import { a } from "@asterdoc/sdk";

const builtForm = a
  .form()
  .name("intake")
  .fields({
    fullName: a.field.text().label("Full name").required().maxLength(100),
    status: a.field.enum().options([{ value: "new" }, { value: "returning" }]),
    deposit: { type: "money", currency: "USD" },
  })
  .build();
```

### Field builder methods

`a.field.<type>()` exists for all 26 types. Every builder has `.label()`, `.description()`, `.required(cond = true)`, `.visible(cond = true)`, `.sensitive(on = true)` and `.build()`. Every type except `fieldset` and `list` has `.default(value)`. The type-specific methods mirror the properties above:

<!-- dep:C6 -->
| Builder | Methods |
|---------|---------|
| `text` | `.minLength(n)`, `.maxLength(n)`, `.pattern(re)`, `.mask(mask)` |
| `uuid`, `uri` | `.minLength(n)`, `.maxLength(n)`, `.pattern(re)` |
| `email` | `.minLength(n)`, `.maxLength(n)` |
| `number` | `.min(n)`, `.max(n)`, `.step(n)` |
| `money` | `.min(n)`, `.max(n)`, `.currency(code)` |
| `percentage` | `.min(n)`, `.max(n)`, `.precision(n)` |
| `rating` | `.min(n)`, `.max(n)`, `.step(n)` |
| `date`, `datetime`, `time` | `.min(s)`, `.max(s)` |
| `enum` | `.options([{ value, label? }])` |
| `multiselect` | `.options([...])`, `.min(n)`, `.max(n)` |
| `identification` | `.allowedTypes(...types)` |
| `address` | `.codes(on = true)` |
| `region` | `.country(code)` |
| `fieldset` | `.field(id, def)`, `.fields({ ... })` |
| `list` | `.item(def)`, `.minItems(n)`, `.maxItems(n)` |

## Add a field

1. Choose a camelCase id that names the thing: `monthlyRent`, not `amount`.
2. Pick the type from the [type selection table](#type-selection-table).
3. Add `label`, the type's constraints, and `required`/`visible` if needed.
4. Run `npx asterdoc validate <file>`. The field is done when it exits 0 and reports no issues.
5. Print a starting payload with `npx asterdoc data template <file> --json --out data.json`. Give every required field a value, put a real value in the new field, and run `npx asterdoc data validate <file> data.json`. It exits 0 when the payload is complete and each value has the right shape.

## See also

- [annexes.md](./annexes.md): when the form collects a file, not a value
- [filling.md](./filling.md): when you fill or change a draft
- [formatting.md](./formatting.md): when you control how values print
