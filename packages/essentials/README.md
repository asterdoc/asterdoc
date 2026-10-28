<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=essentials" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.paradoc.dev/logo-400x400.png" type="image/png">
      <img src="https://assets.paradoc.dev/logo-400x400.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/essentials</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=essentials)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/intent/follow?screen_name=asterdoc)

</div>

[Asterdoc](https://asterdoc.com?utm_source=github&utm_medium=essentials) is **documents as code**. It lets developers and AI agents define, validate, and render business documents using typed, composable schemas.

## Package overview

A curated collection of common business artifacts ready to use with the Asterdoc SDK. Each artifact ships with its full spec and pre-built layers (markdown and PDF) bundled in — no separate downloads, no resolver setup.

## Installation

```bash
npm install @asterdoc/essentials @asterdoc/sdk
```

## Included artifacts

| Domain     | Import                     | Form                                                                       |
| ---------- | -------------------------- | -------------------------------------------------------------------------- |
| tax        | `w9`                       | IRS W-9 — Request for Taxpayer Identification Number                       |
| tax        | `f1099NEC`                 | IRS 1099-NEC — Nonemployee Compensation                                    |
| tax        | `f1099MISC`                | IRS 1099-MISC — Miscellaneous Information                                  |
| tax        | `f4506T`                   | IRS 4506-T — Request for Transcript of Tax Return                          |
| employment | `i9`                       | USCIS I-9 — Employment Eligibility Verification                            |
| banking    | `achBankAccountInfo`       | ACH Bank Account Information                                               |
| banking    | `achChangeForm`            | ACH Change Form                                                            |
| banking    | `achCreditAuthorization`   | ACH Credit Authorization                                                   |
| banking    | `achDebitAuthorization`    | ACH Debit Authorization                                                    |
| banking    | `achDirectDeposit`         | ACH Direct Deposit Authorization                                           |

Import by domain or from the root:

```typescript
import { w9 } from "@asterdoc/essentials/tax";
import { i9 } from "@asterdoc/essentials/employment";
import { achDirectDeposit } from "@asterdoc/essentials/banking";

// or flat
import { w9, i9, achDirectDeposit } from "@asterdoc/essentials";
```

## Usage

Fill a W-9 and render its markdown layer:

```typescript
import { w9 } from "@asterdoc/essentials/tax";

const markdown = await w9
  .fill({
    parties: {
      taxpayer: {
        id: "taxpayer-0",
        name: "Jane Q. Public",
        firstName: "Jane",
        lastName: "Public",
      },
    },
    fields: {
      taxClassification: "individual_or_sole_proprietor",
      ssn: "123-45-6789",
      mailingAddress: {
        line1: "1 Main St",
        locality: "Springfield",
        region: "IL",
        postalCode: "62704",
        country: "US",
      },
    },
  })
  .render({ layer: "markdown" });
```

Render the official PDF layer through the built-in renderer:

```typescript
const pdf = await w9.fill(data).render({ layer: "pdf" });
```

Each artifact's bundled resolver is applied automatically — you don't need to pass one. Validate without filling using `safeParseData`:

```typescript
const result = w9.safeParseData(rawInput);
if (result.success) {
  // result.data is fully typed
}
```

## Changelog

View the [Changelog](https://github.com/asterdoc/asterdoc/blob/main/CHANGELOG.md) for updates.

## Related packages

- [`@asterdoc/sdk`](../sdk) - Complete framework with renderers
- [`@asterdoc/core`](../core) - Core builders and validation
- [`@asterdoc/render`](../render) - MIME-selected PDF, DOCX, and text rendering

## Contributing

We're open to all community contributions! If you'd like to contribute in any way, please read our [contribution guidelines](https://github.com/asterdoc/asterdoc/blob/main/CONTRIBUTING.md) and [code of conduct](https://github.com/asterdoc/asterdoc/blob/main/CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT license.

See [LICENSE](https://github.com/asterdoc/asterdoc/blob/main/LICENSE) for more information.
