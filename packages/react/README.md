<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=react" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/react</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=react)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

Headless React bindings for Asterdoc artifacts, document settings, pagination, signing, and packet previews. The package supplies maintained behavior without choosing visible markup or shipping a stylesheet.

## Install

```sh
npm install @asterdoc/react react
```

The root entry requires no Tailwind setup, font package, PDF engine, viewer, or external state library. It uses React context to scope each document store and `useSyncExternalStore` for focused subscriptions.

## Headless document markup

```tsx
import { ArtifactProvider, useField, type DocumentData } from "@asterdoc/react";
import type { Form } from "@asterdoc/types";

function Name() {
  const name = useField("name");
  return <p>{name.label}: {name.text}</p>;
}

export function Profile({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return <ArtifactProvider artifact={artifact} data={data}><Name /></ArtifactProvider>;
}
```

Providers emit no styled DOM. Focused hooks expose data and correctness bindings:

- `useField`, `useList`, `useTotals`, `useParty`, `usePartyContact`, and `useFormatter`
- `useAnnex` and `useAnnexPicture` for attachments at an annex path
- `useDocumentSettings`, `useDocumentTokens`, `useDocumentTokensAround`, and `usePaperGeometry`
- `usePagination`, `usePage`, `usePagePlan`, and visibility bindings
- `usePageNumber` for a page number drawn in page furniture
- `useSignature`, `resolvePartPlacement`, and `usePdfPages`
- `useFitToWidth` for consumer-owned page furniture

Inputs are immutable snapshots. A provider update publishes only selectors whose resolved value changed. Each provider creates an isolated store, including during SSR, and subscriptions clean up normally under Strict Mode.

## Copyable document components

Visible document components are source you own. Configure the Asterdoc component collection in `components.json`, then use the stock shadcn CLI:

```sh
npx shadcn@latest add @asterdoc/document-styles @asterdoc/pages @asterdoc/document @asterdoc/field
```

The optional `document-styles` preset installs at `styles/asterdoc.css`; import it from the application entry when you want the default Tailwind presentation. Install `pages` for the preview wrapper used by `asterdoc dev`. You may instead copy the canonical files from `packages/components/src/components` and provide all markup and styles yourself.

Installed components import maintained logic from `@asterdoc/react` and local sibling components. Updating the runtime can therefore fix bindings without replacing customized source. The CLI never overwrites an edited component unless you pass `--overwrite` explicitly.

## Rendering integrations

Install `@asterdoc/react-pdf` only when an application needs composition checks, PDF rendering, layer renderers, or the experimental Chromium adapter:

```ts
import { renderPdf } from "@asterdoc/react-pdf";
import { checkComposition } from "@asterdoc/react-pdf/check";
```

The root package remains browser-safe and does not load rendering engines or font files. Composition discovery remains available from `@asterdoc/react/discovery` for authoring tools.
