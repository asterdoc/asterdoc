# `@asterdoc/components`

This private workspace owns the source files distributed as copyable Asterdoc document components. They use `@asterdoc/react` for artifact state, formatting, pagination, signing, and rendering contracts; their markup and Tailwind classes remain in the consumer's project after installation.

The package is private because applications install these files through the Asterdoc component collection rather than importing a versioned UI library.

```sh
npx shadcn@latest add @asterdoc/document-styles @asterdoc/pages @asterdoc/document @asterdoc/field
```

The stock CLI reads the `@asterdoc` namespace from `components.json`, writes source into the configured project, and leaves it under the consumer's ownership. Install `document-styles` explicitly and import `@/styles/asterdoc.css` once from the application stylesheet. Install `pages` explicitly when the app or `asterdoc dev` needs the preview wrapper. The preset loads Tailwind only, so the installed component paths must remain in the application's Tailwind source scan. The consuming application supplies its own font faces and applies them to `.asterdoc-document`.

Manual copying uses the same files under `src/components`. Copy the component and its local sibling imports, install the public packages named in `package.json`, copy `src/styles.css`, and import that stylesheet once. No build output from this private workspace is a runtime dependency.

Run `pnpm --filter @asterdoc/components registry:build` after changing a component, block, artifact, asset, or preset. The generated JSON under `framework/apps/docs/public/r` is committed and checked for freshness.
