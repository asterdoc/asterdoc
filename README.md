<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=main" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">Welcome to Asterdoc</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=main)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

[Asterdoc](https://asterdoc.com?utm_source=github&utm_medium=main) is **documents as code**. It lets developers and AI agents define, validate, and render business documents using typed, composable schemas. This eliminates template drift, broken mappings, and brittle glue code — while giving AI systems a reliable document layer they can safely read, reason over, and generate against in production workflows.

## Package overview

The Asterdoc SDK plus the unified renderer and filesystem resolver used below.

- 📦 **Focused packages** - The SDK includes the default renderer; environment adapters stay explicit
- 🏗️ **Type-safe builders** - Fluent API with full TypeScript support
- 📄 **Multi-format rendering** - PDF, DOCX, HTML, Text from one definition
- ✅ **Automatic validation** - Schema-driven constraints and validation
- 🎯 **Composable artifacts** - Reuse fields, forms, and documents across definitions
- 🤖 **AI-ready** - Built for agent ingestion and verification

## Installation

```bash
npm install @asterdoc/sdk @asterdoc/resolvers
```

## Usage

Define forms with parties, fields, and output layers:

```typescript
import { p } from "@asterdoc/sdk";
import { createFsResolver } from "@asterdoc/resolvers/fs";

// A file-backed layer's bytes come from a resolver, bound once when the form
// is built. Every instance derived from it — every fill, every render —
// carries the same resolver.
const resolver = createFsResolver({ root: process.cwd() });

const leaseAgreement = p
  .form()
  .name("residential-lease-agreement")
  .version("1.0.0")
  .title("Residential Lease Agreement")
  .defaultLayer("markdown")
  .layers({
    markdown: {
      kind: "file",
      path: "fixtures/lease-agreement.md",
      mimeType: "text/markdown",
    },
    html: {
      kind: "file",
      path: "fixtures/lease-agreement.html",
      mimeType: "text/html",
    },
  })
  .parties({
    landlord: p
      .party()
      .label("Landlord")
      .signature({ required: true }),
    tenant: p
      .party()
      .label("Tenant")
      .min(1)
      .max(4)
      .signature({ required: true }),
  })
  .fields({
    leaseId: { type: "uuid", label: "Lease ID" },
    propertyAddress: {
      type: "address",
      label: "Property Address",
      required: true,
    },
    monthlyRent: { type: "money", label: "Monthly Rent", required: true },
    leaseStartDate: { type: "date", label: "Lease Start Date", required: true },
  })
  .build({ resolver });

// Fill with data (automatic validation)
const filledLease = leaseAgreement.fill({
  fields: {
    leaseId: "550e8400-e29b-41d4-a716-446655440000",
    propertyAddress: {
      line1: "123 Main St",
      locality: "Portland",
      region: "OR",
      postalCode: "97201",
      country: "USA",
    },
    monthlyRent: { amount: 1500, currency: "USD" },
    leaseStartDate: "2024-02-01",
  },
});

// Render to multiple formats — no resolver here, it travels with the instance
const markdown = await filledLease.render({
  layer: "markdown",
});
const html = await filledLease.render({
  layer: "html",
});
```

Add file attachments and advanced field types:

```typescript
const advancedLease = p
  .form()
  .name("commercial-lease")
  .version("1.0.0")
  .title("Commercial Lease Agreement")
  .defaultLayer("markdown")
  .layers({
    markdown: {
      kind: "file",
      path: "fixtures/commercial-lease.md",
      mimeType: "text/markdown",
    },
  })
  .allowAdditionalAnnexes(true)
  .annexes({
    photoId: p.annex().title("Photo ID").required(true),
    proofOfIncome: p.annex().title("Proof of Income").required(true),
  })
  .parties({
    landlord: p
      .party()
      .label("Landlord")
      .signature({ required: true }),
    tenant: p
      .party()
      .label("Tenant")
      .max(4)
      .signature({ required: true }),
  })
  .fields({
    leaseId: { type: "uuid", label: "Lease ID", required: true },
    leaseTermMonths: {
      type: "number",
      label: "Lease Term (months)",
      required: true,
    },
    monthlyRent: { type: "money", label: "Monthly Rent", required: true },
    petPolicy: {
      type: "enum",
      enum: [{ value: "no-pets" }, { value: "small-pets" }, { value: "all-pets" }],
      label: "Pet Policy",
      required: true,
    },
  })
  .build();
```

Define static documents and workflow checklists:

```typescript
const leadPaintDisclosure = p
  .document()
  .name("lead-paint-disclosure")
  .version("1.0.0")
  .title("Lead Paint Disclosure")
  .code("EPA-747-K-12-001")
  .issuer("U.S. Environmental Protection Agency")
  .edition({ key: "2025-12", label: "Rev. December 2025", date: "2025-12" })
  .metadata({ agency: "EPA/HUD", cfr: "40 CFR 745" })
  .layers({
    pdf: p
      .layer()
      .file()
      .path("fixtures/lead-paint-disclosure.pdf")
      .mimeType("application/pdf"),
  })
  .defaultLayer("pdf")
  .build();

const leaseChecklist = p
  .checklist()
  .name("lease-application-checklist")
  .version("1.0.0")
  .title("Lease Application Checklist")
  .items([
    {
      id: "application_received",
      title: "Application Received",
      status: { kind: "boolean" },
    },
    {
      id: "credit_check",
      title: "Credit Check Complete",
      status: { kind: "boolean" },
    },
    {
      id: "background_check",
      title: "Background Check Complete",
      status: { kind: "boolean" },
    },
    { id: "lease_signed", title: "Lease Signed", status: { kind: "boolean" } },
  ])
  .build();
```

Combine forms, documents, and checklists into a bundle:

```typescript
const leaseBundle = p
  .bundle()
  .name("residential-lease-bundle")
  .version("1.0.0")
  .title("Residential Lease Bundle")
  .contents([
    { type: "inline", key: "leaseAgreement", artifact: leaseAgreement.toJSON({ includeSchema: false }) },
    { type: "inline", key: "leadPaintDisclosure", artifact: leadPaintDisclosure.toJSON({ includeSchema: false }) },
    { type: "inline", key: "checklist", artifact: leaseChecklist.toJSON({ includeSchema: false }) },
  ])
  .build();
```

Get automatic TypeScript types from your form definitions:

```typescript
import { type InferFormPayload } from "@asterdoc/sdk";

type LeaseData = InferFormPayload<typeof leaseAgreement>;

const data: LeaseData = {
  fields: {
    leaseId: "550e8400-e29b-41d4-a716-446655440000",
    propertyAddress: {
      line1: "123 Main St",
      locality: "Portland",
      region: "OR",
      postalCode: "97201",
      country: "USA",
    },
    monthlyRent: { amount: 1500, currency: "USD" },
    leaseStartDate: "2024-02-01",
  },
};
```

Validate and fill forms with data:

```typescript
// Check if the form schema itself is valid
if (!form.isValid()) {
  console.log("Form schema is invalid");
}

// Fill the form with data (validates during fill)
const filled = form.fill(data); // throws if validation fails

// Or use safeFill to avoid exceptions
const result = form.safeFill(data);
if (result.success) {
  const filled = result.data;
}
```

For a complete production example, see `/incubator/apps/demo/src/demos/leasing`. For API reference and advanced patterns, visit [docs.asterdoc.com](https://docs.asterdoc.com).

## Changelog

View package Changelogs for update.

## Core packages

- [`@asterdoc/core`](https://github.com/asterdoc/asterdoc/blob/main/packages/core) - Core artifacts and builders
- [`@asterdoc/types`](https://github.com/asterdoc/asterdoc/blob/main/packages/types) - TypeScript utilities and types
- [`@asterdoc/schemas`](https://github.com/asterdoc/asterdoc/blob/main/packages/schemas) - JSON Schema definitions
- [`@asterdoc/format`](https://github.com/asterdoc/asterdoc/blob/main/packages/format) - Locale-aware value presentation
- [`@asterdoc/resolvers`](https://github.com/asterdoc/asterdoc/blob/main/packages/resolvers) - File and environment resolvers
- [`@asterdoc/render`](https://github.com/asterdoc/asterdoc/blob/main/packages/render) - Unified PDF, DOCX, and text rendering
- [`@asterdoc/react`](https://github.com/asterdoc/asterdoc/blob/main/packages/react) - Compose and preview a document in React
- [`@asterdoc/react-pdf`](https://github.com/asterdoc/asterdoc/blob/main/packages/react-pdf) - Check, render and seal a React document as PDF

## Contributing

We're open to all community contributions! If you'd like to contribute in any way, please read our [contribution guidelines](https://github.com/asterdoc/asterdoc/blob/main/CONTRIBUTING.md) and [code of conduct](https://github.com/asterdoc/asterdoc/blob/main/CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT license.

See [LICENSE](https://github.com/asterdoc/asterdoc/blob/main/LICENSE) for more information.
