import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: {
		resolve: true,
	},
	splitting: false,
	sourcemap: false,
	clean: true,
	external: [
		'@asterdoc/core',
		'@asterdoc/render',
		'@asterdoc/resolvers',
		'@asterdoc/schemas',
		'zod',
	],
})
