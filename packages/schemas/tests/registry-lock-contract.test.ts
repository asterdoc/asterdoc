/**
 * schemas-012, schemas-013, schemas-014, schemas-017: the registry and lock
 * schemas describe what the CLI writes and what an artifact may carry.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ArtifactSchema } from '../src/zod';
import { LAYER_BINDINGS_RULE, LAYER_FONT_RULE, LAYER_FORMAT_RULE } from '../src/zod/artifacts/shared/layer';
import { LockFileSchema, LockedArtifactSchema } from '../src/zod/registry/lock';
import { RegistryItemNameSchema } from '../src/zod/registry/registry-index';
import { RegistryFileLayerSchema, RegistryItemSchema, RegistryLayerSchema } from '../src/zod/registry/registry-item';

/** The integrity form the CLI's lock file manager writes. */
const cliIntegrity = (s: string) => `sha256-${createHash('sha256').update(s).digest('base64')}`;

const lockedArtifact = {
	kind: 'form',
	version: '1.0.0',
	resolved: 'https://registry.example.com/r/w9.json',
	integrity: cliIntegrity('{}'),
	installedAt: '2026-09-24T12:00:00.000Z',
	output: 'typed',
	path: 'artifacts/@acme/w9.json',
	layers: { pdf: { integrity: cliIntegrity('%PDF'), path: 'artifacts/@acme/w9.pdf' } },
};

const messages = (result: { error?: { issues: Array<{ message: string; path: PropertyKey[] }> } }) =>
	result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [];

describe('schemas-012: the lock file schema', () => {
	it('accepts a lock file as the CLI writes it', () => {
		const lock = {
			$schema: 'https://schema.asterdoc.com/lock.json',
			version: 1,
			artifacts: {
				'@acme/w9': lockedArtifact,
				'@registry.acme.com/w9': lockedArtifact,
			},
		};
		const result = LockFileSchema.safeParse(lock);
		expect(messages(result)).toEqual([]);
	});

	it.each(['json', 'yaml', 'typed', 'ts'])('accepts the %s output format', (output) => {
		expect(LockedArtifactSchema.safeParse({ ...lockedArtifact, output }).success).toBe(true);
	});

	it('refuses the old hex integrity form', () => {
		const hex = `sha256:${createHash('sha256').update('{}').digest('hex')}`;
		expect(messages(LockedArtifactSchema.safeParse({ ...lockedArtifact, integrity: hex }))).toEqual([
			expect.stringMatching(/^integrity: /),
		]);
		const layers = { pdf: { integrity: hex, path: 'w9.pdf' } };
		expect(messages(LockedArtifactSchema.safeParse({ ...lockedArtifact, layers }))).toEqual([
			expect.stringMatching(/^layers\.pdf\.integrity: /),
		]);
	});

	it('refuses an entry with `format` in place of `output`', () => {
		const { output: _output, ...rest } = lockedArtifact;
		expect(messages(LockedArtifactSchema.safeParse({ ...rest, format: 'json' }))).toEqual([
			expect.stringMatching(/^output: /),
		]);
	});

	it.each(['@acme/my_form', '@acme/a--b', 'acme/w9', '@acme/w9-'])('refuses the reference %s', (ref) => {
		const result = LockFileSchema.safeParse({ version: 1, artifacts: { [ref]: lockedArtifact } });
		expect(result.success).toBe(false);
	});
});

describe('the locked edition', () => {
	it('keeps the key of the installed edition beside the version', () => {
		const entry = { ...lockedArtifact, edition: '2024-03' };
		const result = LockFileSchema.safeParse({ version: 1, artifacts: { '@acme/w9': entry } });
		expect(messages(result)).toEqual([]);
		expect(result.data?.artifacts['@acme/w9']).toEqual(entry);
	});

	it('is absent for an artifact that has no editions', () => {
		const parsed = LockedArtifactSchema.parse(lockedArtifact);
		expect('edition' in parsed).toBe(false);
	});

	it.each(['current', 'latest', '3B', 'rev.2024', '', 'a'.repeat(65)])('refuses the edition %j', (edition) => {
		const result = messages(LockedArtifactSchema.safeParse({ ...lockedArtifact, edition }));
		expect(result.length).toBeGreaterThan(0);
		for (const message of result) expect(message).toMatch(/^edition: /);
	});

	it('refuses an edition object: the lock holds the key only', () => {
		expect(messages(LockedArtifactSchema.safeParse({ ...lockedArtifact, edition: { key: '2024-03', label: 'Rev. March 2024' } }))).toEqual([
			'edition: Invalid input: expected string, received object',
		]);
	});

	it('keeps the lock file format version at 1', () => {
		expect(LockFileSchema.parse({ artifacts: {} }).version).toBe(1);
	});
});

describe('schemas-013: the artifact name rules', () => {
	it.each(['my_form-', 'a--b', 'a_b', '-a', 'a-'])('registry and artifact schemas all refuse %s', (name) => {
		expect(RegistryItemNameSchema.safeParse(name).success).toBe(false);
		expect(RegistryItemSchema.shape.name.safeParse(name).success).toBe(false);
		expect(ArtifactSchema.shape.name.safeParse(name).success).toBe(false);
	});

	it.each(['w9', 'w-9', 'form-1040-sr'])('registry and artifact schemas all accept %s', (name) => {
		expect(RegistryItemNameSchema.safeParse(name).success).toBe(true);
		expect(RegistryItemSchema.shape.name.safeParse(name).success).toBe(true);
		expect(ArtifactSchema.shape.name.safeParse(name).success).toBe(true);
	});

	it.each(['W-9', 'Form-1040-SR'])('only the manifest refuses the capital letters of %s', (name) => {
		expect(RegistryItemNameSchema.safeParse(name).success).toBe(false);
		expect(RegistryItemSchema.shape.name.safeParse(name).success).toBe(true);
		expect(ArtifactSchema.shape.name.safeParse(name).success).toBe(true);
	});

	it.each(['w9', 'w-9', 'form-1040-sr', '1099', 'a1-b2'])('a manifest name %s is always a name an artifact file can have', (name) => {
		expect(RegistryItemNameSchema.safeParse(name).success).toBe(true);
		expect(ArtifactSchema.shape.name.safeParse(name).success).toBe(true);
	});
});

describe('schemas-014: the registry file layer extends the artifact file layer', () => {
	const pdfLayer = {
		kind: 'file' as const,
		mimeType: 'application/pdf',
		path: 'layer.pdf',
		url: 'https://example.com/layer.pdf',
	};

	it('keeps every key the artifact file layer defines', () => {
		const input = {
			...pdfLayer,
			checksum: `sha256:${'a'.repeat(64)}`,
			font: { path: 'font.ttf' },
			format: { money: { currencyDisplay: 'none' as const } },
			bindings: { f1_01: 'fields.name' },
		};
		const parsed = RegistryFileLayerSchema.safeParse(input);
		expect(messages(parsed)).toEqual([]);
		expect(parsed.data).toEqual(input);
	});

	it('refuses a key neither layer defines', () => {
		expect(RegistryFileLayerSchema.safeParse({ ...pdfLayer, colour: 'red' }).success).toBe(false);
	});

	it('allows clients to resolve a missing download URL from the item path', () => {
		const { url: _url, ...rest } = pdfLayer;
		expect(messages(RegistryFileLayerSchema.safeParse(rest))).toEqual([]);
	});

	it.each([
		['font', { font: { path: 'font.ttf' } }, LAYER_FONT_RULE],
		['format', { format: { money: { currencyDisplay: 'none' } } }, LAYER_FORMAT_RULE],
		['bindings', { bindings: { f1_01: 'fields.name' } }, LAYER_BINDINGS_RULE],
	] as const)('refuses %s on a layer other than a PDF', (key, extra, rule) => {
		const layer = { ...pdfLayer, mimeType: 'text/markdown', path: 'notice.md', ...extra };
		expect(messages(RegistryFileLayerSchema.safeParse(layer))).toEqual([`${key}: ${rule}`]);
		expect(messages(RegistryLayerSchema.safeParse(layer))).toEqual([`${key}: ${rule}`]);
	});
});

describe('schemas-017: the registry item is a loose object', () => {
	it('keeps artifact-specific keys', () => {
		const item = { kind: 'form', name: 'w9', version: '1.0.0', fields: { name: { type: 'text' } } };
		const parsed = RegistryItemSchema.safeParse(item);
		expect(parsed.data).toEqual(item);
	});
});
