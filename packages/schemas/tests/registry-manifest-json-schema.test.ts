/**
 * The published registry.json schema is what a third party validates a
 * manifest with, so it must refuse what the Zod schema refuses wherever JSON
 * Schema can say it.
 *
 * This package has no JSON Schema validator among its dependencies. The
 * `validate` function below evaluates the 2020-12 keywords the registry
 * schema uses, and throws on a keyword it does not know, so a rule can never
 * pass because it was ignored.
 */
import { describe, expect, it } from 'vitest';
import { generateRegistrySchemas } from '../scripts/export-registry-schemas-zod';
import { REGISTRY_SCHEMA_ID, RegistryIndexSchema } from '../src/zod';

type JsonSchema = Record<string, unknown>;

const ANNOTATIONS = new Set(['$schema', '$id', '$defs', 'title', 'description', 'default', 'format']);

function typeOf(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/** Whether `value` is valid against `schema`, for the keywords the registry schema uses. */
function validate(schema: JsonSchema, value: unknown, root: JsonSchema): boolean {
	const object = typeOf(value) === 'object' ? (value as Record<string, unknown>) : undefined;
	const text = typeof value === 'string' ? value : undefined;
	const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;

	return Object.entries(schema).every(([keyword, rule]) => {
		if (ANNOTATIONS.has(keyword)) return true;
		switch (keyword) {
			case '$ref': {
				const name = /^#\/\$defs\/(.+)$/.exec(rule as string)?.[1];
				const target = name === undefined ? undefined : (root.$defs as Record<string, JsonSchema>)[name];
				if (!target) throw new Error(`Unresolved $ref ${String(rule)}`);
				return validate(target, value, root);
			}
			case 'type':
				return typeOf(value) === rule;
			case 'const':
				return value === rule;
			case 'enum':
				return (rule as unknown[]).includes(value);
			case 'pattern':
				return text === undefined || new RegExp(rule as string, 'u').test(text);
			case 'minLength':
				return text === undefined || [...text].length >= (rule as number);
			case 'maxLength':
				return text === undefined || [...text].length <= (rule as number);
			case 'required':
				return !object || (rule as string[]).every((key) => Object.prototype.hasOwnProperty.call(object, key));
			case 'properties':
				return !object || Object.entries(properties).every(([key, sub]) => !(key in object) || validate(sub, object[key], root));
			case 'additionalProperties':
				return !object || Object.entries(object).every(([key, item]) =>
					key in properties || (rule === false ? false : validate(rule as JsonSchema, item, root)));
			case 'propertyNames':
				return !object || Object.keys(object).every((key) => validate(rule as JsonSchema, key, root));
			case 'minProperties':
				return !object || Object.keys(object).length >= (rule as number);
			case 'items':
				return !Array.isArray(value) || value.every((item) => validate(rule as JsonSchema, item, root));
			case 'anyOf':
				return (rule as JsonSchema[]).some((sub) => validate(sub, value, root));
			case 'oneOf':
				return (rule as JsonSchema[]).filter((sub) => validate(sub, value, root)).length === 1;
			case 'not':
				return !validate(rule as JsonSchema, value, root);
			default:
				throw new Error(`The test validator does not know the keyword ${keyword}`);
		}
	});
}

const schemas = await generateRegistrySchemas();
const registrySchema = schemas['registry.json'] as JsonSchema;
const defs = registrySchema.$defs as Record<string, { properties: Record<string, JsonSchema> } & JsonSchema>;

const jsonSchemaAccepts = (manifest: unknown) => validate(registrySchema, manifest, registrySchema);
const zodAccepts = (manifest: unknown) => RegistryIndexSchema.safeParse(manifest).success;

const sha = (digit: string) => digit.repeat(64);

const w9 = {
	name: 'w-9',
	kind: 'form',
	title: 'Request for Taxpayer Identification Number and Certification',
	currentEdition: '2024-03',
	editions: {
		'2024-03': {
			label: 'Rev. March 2024',
			date: '2024-03',
			latestVersion: '1.1.0',
			versions: {
				'1.1.0': { path: 'w-9/2024-03/1.1.0/w-9.json', sha256: sha('a') },
				'1.0.0': { path: 'w-9/2024-03/1.0.0/w-9.json', sha256: sha('b') },
			},
		},
		'2018-10': {
			label: 'Rev. October 2018',
			date: '2018-10',
			effectiveFrom: '2018-11-01',
			latestVersion: '1.0.0',
			versions: { '1.0.0': { path: 'w-9/2018-10/1.0.0/w-9.json', sha256: sha('c') } },
		},
	},
};

const petAddendum = {
	name: 'pet-addendum',
	kind: 'form',
	latestVersion: '1.1.0',
	versions: {
		'1.1.0': { path: 'pet-addendum/1.1.0/pet-addendum.json', sha256: sha('d') },
		'1.0.0': { path: 'pet-addendum/pet-addendum.json', sha256: sha('e') },
	},
};

const manifest = (...items: unknown[]) => ({ $schema: REGISTRY_SCHEMA_ID, name: 'acme', items });
const entry = { path: 'x.json', sha256: sha('f') };
const edition = w9.editions['2018-10'];
const withEdition = (extra: unknown) => ({ ...w9, editions: { ...w9.editions, '2018-10': extra } });
const withVersion = (extra: unknown) => ({ ...petAddendum, versions: { ...petAddendum.versions, '1.0.0': extra } });

describe('the published registry.json schema', () => {
	it('is published at the registry schema address', () => {
		expect(REGISTRY_SCHEMA_ID).toBe('https://schema.paradoc.dev/registry.json');
		expect(registrySchema.$id).toBe(REGISTRY_SCHEMA_ID);
		expect(registrySchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
	});

	it('states editions and versions as keyed objects with a key rule', () => {
		const item = defs.RegistryItemSummary!.properties;
		const editionEntry = defs.RegistryEditionEntry!.properties;
		for (const versions of [item.versions!, editionEntry.versions!]) {
			expect(versions).toMatchObject({
				type: 'object',
				minProperties: 1,
				propertyNames: { type: 'string', pattern: expect.stringMatching(/^\^\(0\|\[1-9\]/) },
				additionalProperties: { $ref: '#/$defs/RegistryVersionEntry' },
			});
		}
		expect(item.editions).toMatchObject({
			type: 'object',
			minProperties: 1,
			propertyNames: { type: 'string', maxLength: 64, pattern: expect.stringContaining('(?!(?:current|latest|editions|tags|diff)$)') },
			additionalProperties: { $ref: '#/$defs/RegistryEditionEntry' },
		});
	});

	it('states the editions-or-versions rule as oneOf', () => {
		expect(defs.RegistryItemSummary!.oneOf).toEqual([
			{ required: ['currentEdition', 'editions'], not: { anyOf: [{ required: ['latestVersion'] }, { required: ['versions'] }] } },
			{ required: ['latestVersion', 'versions'], not: { anyOf: [{ required: ['currentEdition'] }, { required: ['editions'] }] } },
		]);
	});

	it('has no version, path or artifactsPath where the old shape had them', () => {
		expect(Object.keys(defs.RegistryItemSummary!.properties)).toEqual([
			'name', 'kind', 'title', 'description', 'currentEdition', 'editions', 'latestVersion', 'versions', 'layers', 'tags',
		]);
		expect(Object.keys(registrySchema.properties as object)).toEqual([
			'$schema', 'name', 'homepage', 'description', 'enableTelemetry', 'enableDirectory', 'items',
		]);
		expect(Object.keys(defs.RegistryVersionEntry!.properties)).toEqual(['path', 'sha256']);
		expect(Object.keys(defs.RegistryEditionEntry!.properties)).toEqual(['label', 'date', 'effectiveFrom', 'latestVersion', 'versions']);
	});

	it('tells a third party that the defaults are statements, never comparisons', () => {
		const item = defs.RegistryItemSummary!.properties;
		const currentEdition = item.currentEdition!.description as string;
		expect(currentEdition).toContain("publisher's statement");
		expect(currentEdition).toContain('not the newest edition by date');
		expect(currentEdition).toContain('never compares dates');
		expect(currentEdition).toContain('key of editions');
		for (const latestVersion of [item.latestVersion!, defs.RegistryEditionEntry!.properties.latestVersion!]) {
			const description = latestVersion.description as string;
			expect(description).toContain("publisher's statement");
			expect(description).toContain('key of versions');
			expect(description).toContain('a pre-release is the default only when the publisher points at it');
			expect(description).toContain('never compares version numbers');
		}
		expect(defs.RegistryVersionEntry!.properties.path!.description).toContain('relative to the registry base address');
		expect(defs.RegistryVersionEntry!.properties.sha256!.description).toContain('bytes of the artifact file');
	});
});

describe('a JSON Schema validator and the Zod schema agree', () => {
	it.each([
		['an artifact that has editions', manifest(w9)],
		['an artifact that has no editions', manifest(petAddendum)],
		['both', manifest(w9, petAddendum)],
		['no items', manifest()],
		['a pre-release version', manifest({ ...petAddendum, versions: { ...petAddendum.versions, '2.0.0-rc.1': entry } })],
	])('both accept %s', (_case, input) => {
		expect(zodAccepts(input)).toBe(true);
		expect(jsonSchemaAccepts(input)).toBe(true);
	});

	it.each([
		['an item with neither editions nor versions', manifest({ name: 'w-9', kind: 'form' })],
		['an item with both', manifest({ ...w9, latestVersion: '1.1.0', versions: petAddendum.versions })],
		['editions and the item\'s own latestVersion', manifest({ ...w9, latestVersion: '1.1.0' })],
		['editions and the item\'s own versions', manifest({ ...w9, versions: petAddendum.versions })],
		['versions and currentEdition', manifest({ ...petAddendum, currentEdition: '2024-03' })],
		['editions without currentEdition', manifest({ name: 'w-9', kind: 'form', editions: w9.editions })],
		['currentEdition without editions', manifest({ name: 'w-9', kind: 'form', currentEdition: '2024-03' })],
		['versions without latestVersion', manifest({ name: 'x', kind: 'form', versions: petAddendum.versions })],
		['latestVersion without versions', manifest({ name: 'x', kind: 'form', latestVersion: '1.0.0' })],
		['an empty editions object', manifest({ ...w9, editions: {} })],
		['an empty versions object', manifest({ ...petAddendum, versions: {} })],
		['an empty versions object in an edition', manifest(withEdition({ ...edition, versions: {} }))],
		['editions as an array', manifest({ ...w9, editions: Object.values(w9.editions) })],
		['versions as an array', manifest({ ...petAddendum, versions: Object.values(petAddendum.versions) })],
		['the edition key current', manifest({ ...w9, editions: { ...w9.editions, current: edition } })],
		['the edition key latest', manifest({ ...w9, editions: { ...w9.editions, latest: edition } })],
		['an uppercase edition key', manifest({ ...w9, editions: { ...w9.editions, '3B': edition } })],
		['an edition key of 65 characters', manifest({ ...w9, editions: { ...w9.editions, ['a'.repeat(65)]: edition } })],
		['the version key latest', manifest({ ...petAddendum, versions: { ...petAddendum.versions, latest: entry } })],
		['a version key with build metadata', manifest({ ...petAddendum, versions: { ...petAddendum.versions, '1.2.0+build.1': entry } })],
		['a version key that is not SemVer', manifest({ ...petAddendum, versions: { ...petAddendum.versions, '1.2': entry } })],
		['a latestVersion with build metadata', manifest({ ...petAddendum, latestVersion: '1.1.0+build.1' })],
		['the currentEdition current', manifest({ ...w9, currentEdition: 'current' })],
		['an edition entry with key', manifest(withEdition({ ...edition, key: '2018-10' }))],
		['an edition entry with no label', manifest(withEdition({ latestVersion: '1.0.0', versions: edition.versions }))],
		['an edition entry with no latestVersion', manifest(withEdition({ label: 'x', versions: edition.versions }))],
		['an edition date that is not a real day', manifest(withEdition({ ...edition, date: '2025-02-31' }))],
		['a partial effectiveFrom', manifest(withEdition({ ...edition, effectiveFrom: '2018-11' }))],
		['a version entry with an extra key', manifest(withVersion({ ...entry, notes: 'x' }))],
		['a version entry with no sha256', manifest(withVersion({ path: 'x.json' }))],
		['a version entry with no path', manifest(withVersion({ sha256: sha('f') }))],
		['a path with a leading slash', manifest(withVersion({ ...entry, path: '/x.json' }))],
		['a path with a parent segment', manifest(withVersion({ ...entry, path: 'a/../x.json' }))],
		['a path with a current segment', manifest(withVersion({ ...entry, path: './x.json' }))],
		['a path with a backslash', manifest(withVersion({ ...entry, path: 'a\\x.json' }))],
		['a path with another extension', manifest(withVersion({ ...entry, path: 'x.pdf' }))],
		['a path of more than 500 characters', manifest(withVersion({ ...entry, path: `${'a/'.repeat(248)}x.json` }))],
		['an uppercase sha256', manifest(withVersion({ ...entry, sha256: sha('A') }))],
		['a short sha256', manifest(withVersion({ ...entry, sha256: 'f'.repeat(63) }))],
		['a name with a capital letter', manifest({ ...petAddendum, name: 'W-9' })],
		['a name of more than 128 characters', manifest({ ...petAddendum, name: 'a'.repeat(129) })],
		['a top-level version', manifest({ ...petAddendum, version: '1.1.0' })],
		['a top-level path', manifest({ ...petAddendum, path: 'pet-addendum.json' })],
		['the old item shape', manifest({ name: 'w9', kind: 'form', version: '1.0.0', path: 'w9.json' })],
		['artifactsPath', { ...manifest(w9), artifactsPath: '/r' }],
		['an unknown kind', manifest({ ...petAddendum, kind: 'template' })],
	])('both refuse %s', (_case, input) => {
		expect(zodAccepts(input)).toBe(false);
		expect(jsonSchemaAccepts(input)).toBe(false);
	});

	// JSON Schema has no keyword that compares a value with the keys of a
	// sibling, or one member of an array with another. These rules are in the
	// Zod schema only, and each description states them in words.
	it.each([
		['a currentEdition that is not a key of editions', manifest({ ...w9, currentEdition: '2025-01' })],
		["an edition's latestVersion that is not a key of its versions", manifest(withEdition({ ...edition, latestVersion: '2.0.0' }))],
		["an item's latestVersion that is not a key of its versions", manifest({ ...petAddendum, latestVersion: '2.0.0' })],
		['two items with the same name', manifest(petAddendum, { ...petAddendum, versions: { '1.1.0': entry }, name: 'pet-addendum' })],
		['two versions with the same path', manifest({ ...petAddendum, versions: { '1.1.0': entry, '1.0.0': entry } })],
	])('only the Zod schema refuses %s', (_case, input) => {
		expect(zodAccepts(input)).toBe(false);
		expect(jsonSchemaAccepts(input)).toBe(true);
	});
});

describe('the test validator', () => {
	it('refuses a keyword it does not know, so no rule passes by being ignored', () => {
		expect(() => validate({ uniqueItems: true }, [], {})).toThrow('does not know the keyword uniqueItems');
	});

	it('knows every keyword of the published lock schema too', () => {
		const lock = schemas['lock.json'] as JsonSchema;
		const artifact = {
			kind: 'form',
			edition: '2024-03',
			version: '1.0.0',
			resolved: 'https://registry.example.com/w-9/2024-03/1.0.0/w-9.json',
			integrity: `sha256-${'A'.repeat(43)}=`,
			installedAt: '2026-09-24T12:00:00.000Z',
			output: 'json',
			path: 'artifacts/@acme/w-9.json',
			layers: {},
		};
		expect(validate(lock, { version: 1, artifacts: { '@acme/w-9': artifact } }, lock)).toBe(true);
		expect(validate(lock, { version: 1, artifacts: { '@acme/w-9': { ...artifact, edition: 'current' } } }, lock)).toBe(false);
	});
});
