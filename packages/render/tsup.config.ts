import { defineConfig } from 'tsup'

const publicEntries = ['src/index.ts', 'src/text.ts', 'src/text/field-formatter.ts', 'src/pdf.ts', 'src/docx.ts']
const providerCarryingModules = ['src/default-formatter.ts']

export default defineConfig({
  entry: [...publicEntries, ...providerCarryingModules],
  format: ['esm'],
  dts: { resolve: true },
  splitting: true,
  sourcemap: false,
  clean: true,
  external: ['@asterdoc/types'],
})
