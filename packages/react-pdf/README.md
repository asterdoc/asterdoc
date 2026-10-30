<p align="center">
  <a href="https://asterdoc.com?utm_source=github&utm_medium=react-pdf" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" type="image/png">
      <img src="https://assets.asterdoc.com/asterdoc-logo-400x400-dark.png" height="64" alt="Asterdoc logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">@asterdoc/react-pdf</h1>

<div align="center">

[![Asterdoc documentation](https://img.shields.io/badge/Documentation-Asterdoc-red.svg)](https://docs.asterdoc.com?utm_source=github&utm_medium=react-pdf)
[![Follow on Twitter](https://img.shields.io/twitter/follow/asterdoc?style=social)](https://x.com/asterdoc)

</div>

Explicit Node integration for rendering `@asterdoc/react` compositions to PDF and checking them before rendering. The default entry installs Takumi. Install the optional `puppeteer` and `tailwindcss` peers only when using `@asterdoc/react-pdf/chromium`.

The headless `@asterdoc/react` package does not install a PDF engine, browser driver, CSS compiler, or font files.

```sh
pnpm add @asterdoc/react-pdf
```

| Entry | Purpose |
| --- | --- |
| `@asterdoc/react-pdf` | `renderPdf`, PDF adapter types, Takumi, resources, and React layer renderers |
| `@asterdoc/react-pdf/check` | `checkComposition` and `checkElement` without producing PDF bytes |
| `@asterdoc/react-pdf/chromium` | The Chromium adapter; requires the optional `puppeteer` and `tailwindcss` peers |

```tsx
import { renderPdf, type PdfAdapter } from "@asterdoc/react-pdf";

const result = await renderPdf(<Invoice data={data} />);

const companyEngine: PdfAdapter = {
  name: "company-engine",
  directions: ["ltr"],
  async render(input, options) {
    return renderWithCompanyEngine(input, options);
  },
};

await renderPdf(<Invoice data={data} />, { adapter: companyEngine });
```

Document components inherit typography from the consumer application. A paginated browser preview records the application CSS and exact font-resource identities in its page plan; Chromium rendering consumes that same snapshot. Headless callers may instead provide shared explicit font resources. The default Takumi adapter embeds the captured fonts and ignores the captured CSS, because every class a document uses is checked against its vocabulary; it refuses `applicationCss` passed by the caller rather than silently dropping it. A missing Chromium peer raises `MissingAdapterPeerError`; an installed engine that fails during rendering keeps its original initialization error.
