import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/index.ts', 'src/phone.ts', 'src/regions.ts'],
	format: ['esm'],
	dts: {
		resolve: true,
	},
	splitting: false,
	sourcemap: false,
	clean: true,
	external: ['@asterdoc/types', 'libphonenumber-js'],
})
