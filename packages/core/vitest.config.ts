import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
	define: {
		__ASTERDOC_CORE_VERSION__: JSON.stringify(packageJson.version),
	},
	test: {
		silent: true,
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['tests/**', 'node_modules/**', 'dist/**'],
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
});
