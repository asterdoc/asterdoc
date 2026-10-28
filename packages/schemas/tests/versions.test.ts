import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASTERDOC_SCHEMA_URL } from '../src';
import {
	SCHEMA_VERSION,
	SCHEMA_VERSIONS,
	isSchemaVersion,
	readSchemaAddress,
	schemaVersionUrl,
} from '../src/zod';

const schemasDir = join(__dirname, '..', 'schemas');

describe('schema versions', () => {
	it('lists published versions oldest first, and the last is current', () => {
		expect([...SCHEMA_VERSIONS]).toEqual([...SCHEMA_VERSIONS].sort());
		expect(new Set(SCHEMA_VERSIONS).size).toBe(SCHEMA_VERSIONS.length);
		expect(SCHEMA_VERSIONS.at(-1)).toBe(SCHEMA_VERSION);
	});

	it('serializes artifacts with the current dated address', () => {
		expect(ASTERDOC_SCHEMA_URL).toBe(`https://schema.asterdoc.com/${SCHEMA_VERSION}.json`);
		expect(schemaVersionUrl(SCHEMA_VERSION)).toBe(ASTERDOC_SCHEMA_URL);
	});

	it('starts the history at 2026-10-28 on schema.asterdoc.com', () => {
		expect([...SCHEMA_VERSIONS]).toEqual(['2026-10-28']);
		expect(ASTERDOC_SCHEMA_URL).toBe('https://schema.asterdoc.com/2026-10-28.json');
	});

	it('publishes the current dated bundle as an Asterdoc schema', () => {
		const bundle = JSON.parse(readFileSync(join(schemasDir, `${SCHEMA_VERSION}.json`), 'utf-8'));
		expect(bundle.$id).toBe(schemaVersionUrl(SCHEMA_VERSION));
		expect(bundle.title).toBe('Asterdoc Schema');
		expect(bundle.description).toBe(`Asterdoc JSON Schema specification version ${SCHEMA_VERSION}`);
		expect(bundle.$ref).toBe('#/$defs/Asterdoc');
		expect(bundle.$defs.Asterdoc).toBeDefined();
		expect(bundle.$defs.Form).toBeDefined();
		expect(existsSync(join(schemasDir, SCHEMA_VERSION, 'form.json'))).toBe(true);
	});

	it('keeps the dated bundle a self-contained document', () => {
		const text = readFileSync(join(schemasDir, `${SCHEMA_VERSION}.json`), 'utf-8');
		expect(text).not.toMatch(/"\$ref": "https:/);
	});
});

describe('readSchemaAddress', () => {
	it.each([
		['a dated bundle', 'https://schema.asterdoc.com/2026-10-28.json', { kind: 'known', version: '2026-10-28' }],
		['a dated individual schema', 'https://schema.asterdoc.com/2026-10-28/form.json', { kind: 'known', version: '2026-10-28' }],
		['the current address', ASTERDOC_SCHEMA_URL, { kind: 'known', version: SCHEMA_VERSION }],
		['the undated latest bundle', 'https://schema.asterdoc.com/schema.json', { kind: 'undated' }],
		['an unpublished date', 'https://schema.asterdoc.com/2030-01-01.json', { kind: 'unknown-version', version: '2030-01-01' }],
		['an unpublished individual schema', 'https://schema.asterdoc.com/2026-10-27/form.json', { kind: 'unknown-version', version: '2026-10-27' }],
		['a dated address with another file shape', 'https://schema.asterdoc.com/2026-10-28/Form.json', { kind: 'undated' }],
		['another host', 'https://example.com/2026-10-28.json', { kind: 'foreign' }],
		['a look-alike host', 'https://schema.asterdoc.com.example.com/2026-10-28.json', { kind: 'foreign' }],
	])('reads %s', (_label, address, expected) => {
		expect(readSchemaAddress(address)).toEqual(expected);
	});

	it('knows only published versions', () => {
		expect(isSchemaVersion('2026-10-28')).toBe(true);
		expect(isSchemaVersion('2026-10-27')).toBe(false);
	});
});
