/**
 * The registry manifest (registry.json): one item for each artifact name,
 * with every edition and version of it. Each rule has a passing case and a
 * failing case, and each failing case pins the path and the message, so a
 * validator points at the wrong field.
 */
import { describe, expect, it } from 'vitest';
import {
	ArtifactEditionSchema,
	REGISTRY_ARTIFACT_PATH_PATTERN,
	REGISTRY_EDITIONS_EMPTY_RULE,
	REGISTRY_ITEM_EDITIONS_ONLY_RULE,
	REGISTRY_ITEM_RELEASES_RULE,
	REGISTRY_VERSIONS_EMPTY_RULE,
	RegistryEditionEntrySchema,
	RegistryIndexSchema,
	RegistryItemNameSchema,
	RegistryItemSummarySchema,
	RegistryVersionEntrySchema,
	RegistryVersionKeySchema,
	type RegistryIndex,
	type RegistryItemSummary,
} from '../src/zod';

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

const manifest = (...items: unknown[]) => ({ name: 'acme', items });

type Issue = [path: PropertyKey[], message: string];

const issues = (result: { error?: { issues: Array<{ message: string; path: PropertyKey[] }> } }): Issue[] =>
	result.error?.issues.map((issue) => [issue.path, issue.message]) ?? [];

const itemIssues = (item: unknown) => issues(RegistryItemSummarySchema.safeParse(item));

/** `w9` with one edition entry replaced. */
const withEdition = (entry: unknown) => ({ ...w9, editions: { ...w9.editions, '2024-03': entry } });

/** `petAddendum` with one version entry replaced. */
const withVersion = (entry: unknown) => ({ ...petAddendum, versions: { ...petAddendum.versions, '1.1.0': entry } });

describe('the approved shapes', () => {
	it('accepts an artifact that has editions, and keeps every key', () => {
		const result = RegistryItemSummarySchema.safeParse(w9);
		expect(issues(result)).toEqual([]);
		expect(result.data).toEqual(w9);
	});

	it('accepts an artifact that has no editions, and keeps every key', () => {
		const result = RegistryItemSummarySchema.safeParse(petAddendum);
		expect(issues(result)).toEqual([]);
		expect(result.data).toEqual(petAddendum);
	});

	it('accepts a manifest with both, and the registry fields that did not change', () => {
		const input = {
			$schema: 'https://schema.asterdoc.com/registry.json',
			name: 'acme',
			homepage: 'https://acme.example.com',
			description: 'Acme forms',
			enableTelemetry: false,
			enableDirectory: false,
			items: [w9, petAddendum],
		};
		const result = RegistryIndexSchema.safeParse(input);
		expect(issues(result)).toEqual([]);
		expect(result.data).toEqual(input);
	});

	it('types an item as one of two forms that a reader narrows on editions', () => {
		const parsed: RegistryIndex = RegistryIndexSchema.parse(manifest(w9, petAddendum));
		const paths = parsed.items.map((item: RegistryItemSummary) =>
			item.editions === undefined
				? item.versions[item.latestVersion]?.path
				: item.editions[item.currentEdition]?.latestVersion,
		);
		expect(paths).toEqual(['1.1.0', 'pet-addendum/1.1.0/pet-addendum.json']);
	});
});

describe('rule 1: one shape always', () => {
	it('accepts an artifact with one release as versions with one entry', () => {
		const item = { name: 'nda', kind: 'document', latestVersion: '1.0.0', versions: { '1.0.0': { path: 'nda.json', sha256: sha('a') } } };
		expect(itemIssues(item)).toEqual([]);
	});

	it.each(['version', 'path'])('refuses a top-level %s', (key) => {
		expect(itemIssues({ ...petAddendum, [key]: key === 'version' ? '1.1.0' : 'pet-addendum.json' })).toEqual([
			[[], `Unrecognized key: "${key}"`],
		]);
	});

	it('refuses the old item shape', () => {
		const result = RegistryItemSummarySchema.safeParse({ name: 'w9', kind: 'form', version: '1.0.0', path: 'w9.json' });
		expect(issues(result)).toEqual([
			[[], 'Unrecognized keys: "version", "path"'],
			[[], REGISTRY_ITEM_RELEASES_RULE],
		]);
	});
});

describe('rule 2: editions or versions, never both, never neither', () => {
	const { currentEdition, editions } = w9;
	const { latestVersion, versions } = petAddendum;
	const base = { name: 'w-9', kind: 'form' };

	it('refuses an item with neither', () => {
		expect(itemIssues(base)).toEqual([[[], REGISTRY_ITEM_RELEASES_RULE]]);
	});

	it('refuses an item with both, at each version field', () => {
		expect(itemIssues({ ...w9, latestVersion, versions })).toEqual([
			[['latestVersion'], REGISTRY_ITEM_EDITIONS_ONLY_RULE],
			[['versions'], REGISTRY_ITEM_EDITIONS_ONLY_RULE],
		]);
	});

	it.each([
		['latestVersion', { latestVersion }],
		['versions', { versions }],
	])('refuses an item with editions and its own %s', (key, extra) => {
		expect(itemIssues({ ...w9, ...extra })).toEqual([[[key], REGISTRY_ITEM_EDITIONS_ONLY_RULE]]);
	});

	it.each([
		['editions without currentEdition', { editions }, 'currentEdition', 'Required with editions: name the edition to use by default'],
		['currentEdition without editions', { currentEdition }, 'editions', 'Required with currentEdition: list the editions'],
		['versions without latestVersion', { versions }, 'latestVersion', 'Required with versions: name the version to use by default'],
		['latestVersion without versions', { latestVersion }, 'versions', 'Required with latestVersion: list the versions'],
	])('refuses %s', (_case, extra, path, message) => {
		expect(itemIssues({ ...base, ...extra })).toEqual([[[path], message]]);
	});

	it('refuses an empty editions object', () => {
		expect(itemIssues({ ...base, currentEdition, editions: {} })).toEqual([[['editions'], REGISTRY_EDITIONS_EMPTY_RULE]]);
	});

	it('refuses an empty versions object, on the item and in an edition', () => {
		expect(itemIssues({ ...base, latestVersion, versions: {} })).toEqual([[['versions'], REGISTRY_VERSIONS_EMPTY_RULE]]);
		expect(itemIssues(withEdition({ label: 'Rev. March 2024', latestVersion: '1.0.0', versions: {} }))).toEqual([
			[['editions', '2024-03', 'versions'], REGISTRY_VERSIONS_EMPTY_RULE],
		]);
	});
});

describe('rule 3: editions and versions are keyed objects', () => {
	it.each([
		['an array of editions', { ...w9, editions: Object.values(w9.editions) }, ['editions']],
		['an array of versions', { ...petAddendum, versions: Object.values(petAddendum.versions) }, ['versions']],
	])('refuses %s', (_case, item, path) => {
		expect(itemIssues(item)).toEqual([[path, 'Invalid input: expected record, received array']]);
	});

	it.each(['3B', 'rev.2024', '2024-', '-2024', 'a--b', 'a_b', 'editions', 'tags', 'diff', 'a'.repeat(65)])(
		'refuses the edition key %s',
		(key) => {
			const result = itemIssues({ ...w9, currentEdition: '2024-03', editions: { ...w9.editions, [key]: w9.editions['2018-10'] } });
			expect(result).toHaveLength(1);
			expect(result[0]?.[0]).toEqual(['editions', key]);
			expect(result[0]?.[1]).toMatch(key.length > 64 ? /Too big/ : /^Expected an edition key: .*; got "/);
		},
	);

	it.each(['3b', '2024', '2024-03-15', 'a'.repeat(64)])('accepts the edition key %s', (key) => {
		const entry = { label: 'x', latestVersion: '1.0.0', versions: { '1.0.0': { path: 'x.json', sha256: sha('a') } } };
		expect(itemIssues({ name: 'x', kind: 'form', currentEdition: key, editions: { [key]: entry } })).toEqual([]);
	});
});

describe('rule 4: an edition entry', () => {
	const entry = w9.editions['2024-03'];

	it('accepts the edition facts of the artifact schema, without key', () => {
		for (const date of ['2024', '2024-03', '2024-03-15']) {
			expect(itemIssues(withEdition({ ...entry, date, effectiveFrom: '2024-04-01' }))).toEqual([]);
		}
		const { latestVersion: _latestVersion, versions: _versions, ...facts } = entry;
		expect(ArtifactEditionSchema.safeParse({ key: '2024-03', ...facts }).success).toBe(true);
	});

	it('refuses key, because the key is the object key', () => {
		expect(itemIssues(withEdition({ ...entry, key: '2024-03' }))).toEqual([
			[['editions', '2024-03'], 'Unrecognized key: "key"'],
		]);
	});

	it('refuses a property it does not define', () => {
		expect(itemIssues(withEdition({ ...entry, sequence: 3 }))).toEqual([
			[['editions', '2024-03'], 'Unrecognized key: "sequence"'],
		]);
	});

	it.each([
		['label', 'Invalid input: expected string, received undefined'],
		['latestVersion', 'Invalid input: expected string, received undefined'],
		['versions', 'Invalid input: expected record, received undefined'],
	])('requires %s', (key, message) => {
		const { [key as keyof typeof entry]: _removed, ...rest } = entry;
		expect(itemIssues(withEdition(rest))).toEqual([[['editions', '2024-03', key], message]]);
	});

	it.each(['2024-13', '2024-03-00', '2025-02-31', '03/2024'])('refuses the date %s with the artifact date rule', (date) => {
		const message = 'Expected an edition date as YYYY, YYYY-MM or YYYY-MM-DD that names a real day';
		expect(itemIssues(withEdition({ ...entry, date }))).toEqual([[['editions', '2024-03', 'date'], message]]);
		expect(issues(ArtifactEditionSchema.safeParse({ key: 'k', label: 'x', date }))).toEqual([[['date'], message]]);
	});

	it('refuses a partial effectiveFrom', () => {
		expect(itemIssues(withEdition({ ...entry, effectiveFrom: '2024-03' }))).toEqual([
			[['editions', '2024-03', 'effectiveFrom'], 'Invalid ISO date'],
		]);
	});

	it('refuses an empty label', () => {
		expect(RegistryEditionEntrySchema.safeParse({ ...entry, label: '' }).success).toBe(false);
	});
});

describe('rule 5: a version entry', () => {
	const entry = { path: 'pet-addendum/1.1.0/pet-addendum.json', sha256: sha('d') };
	const at = ['versions', '1.1.0'];

	it.each(['path', 'sha256'] as const)('requires %s', (key) => {
		const { [key]: _removed, ...rest } = entry;
		expect(itemIssues(withVersion(rest))).toEqual([[[...at, key], 'Invalid input: expected string, received undefined']]);
	});

	it.each(['date', 'notes', 'yanked', 'version'])('refuses the extra key %s', (key) => {
		expect(itemIssues(withVersion({ ...entry, [key]: 'x' }))).toEqual([[at, `Unrecognized key: "${key}"`]]);
	});

	it.each([
		'w-9.json',
		'w-9/2024-03/1.0.0/w-9.json',
		'forms/W-9_v1.yaml',
		'a/b.c/d.yml',
		'.hidden/x.json',
		`${'a/'.repeat(247)}x.json`,
	])('accepts the path %s', (path) => {
		expect(path.length).toBeLessThanOrEqual(500);
		expect(itemIssues(withVersion({ ...entry, path }))).toEqual([]);
	});

	it.each([
		['a leading slash', '/w-9.json'],
		['a parent segment', '../w-9.json'],
		['a parent segment inside', 'a/../w-9.json'],
		['a current segment', './w-9.json'],
		['a current segment inside', 'a/./w-9.json'],
		['an empty segment', 'a//w-9.json'],
		['a backslash', 'a\\w-9.json'],
		['an encoded segment', 'a/%2e%2e/w-9.json'],
		['a full address', 'https://example.com/w-9.json'],
		['a query', 'w-9.json?v=1'],
		['a space', 'w 9.json'],
		['another extension', 'w-9.pdf'],
		['no file name', 'a/.json'],
		['no extension', 'w-9'],
		['a trailing newline', 'w-9.json\n'],
		['an empty string', ''],
	])('refuses a path with %s', (_case, path) => {
		const result = itemIssues(withVersion({ ...entry, path }));
		expect(result).toHaveLength(1);
		expect(result[0]?.[0]).toEqual([...at, 'path']);
		expect(result[0]?.[1]).toMatch(/^Expected a path relative to the registry base address/);
	});

	it('refuses a path of more than 500 characters', () => {
		const path = `${'a/'.repeat(248)}x.json`;
		expect(path.length).toBe(502);
		expect(REGISTRY_ARTIFACT_PATH_PATTERN.test(path)).toBe(true);
		expect(itemIssues(withVersion({ ...entry, path }))).toEqual([
			[[...at, 'path'], 'Too big: expected string to have <=500 characters'],
		]);
	});

	it.each([
		['uppercase hex', sha('A')],
		['63 digits', 'a'.repeat(63)],
		['65 digits', 'a'.repeat(65)],
		['a prefix', `sha256:${sha('a')}`],
		['base64', 'n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg='],
		['a letter that is not hex', sha('g')],
	])('refuses a sha256 with %s', (_case, sha256) => {
		expect(itemIssues(withVersion({ ...entry, sha256 }))).toEqual([
			[[...at, 'sha256'], 'Expected a SHA-256 digest as 64 lowercase hex digits'],
		]);
	});

	it('is strict on its own', () => {
		expect(RegistryVersionEntrySchema.safeParse(entry).success).toBe(true);
		expect(RegistryVersionEntrySchema.safeParse({ ...entry, notes: 'x' }).success).toBe(false);
	});
});

describe('rule 6: version keys', () => {
	const entry = { path: 'x.json', sha256: sha('a') };
	const item = (version: string) => ({ name: 'x', kind: 'form', latestVersion: version, versions: { [version]: entry } });

	it.each(['1.0.0', '0.0.0', '10.20.30', '1.0.0-beta', '1.0.0-rc.1', '1.0.1-0'])('accepts %s', (version) => {
		expect(itemIssues(item(version))).toEqual([]);
	});

	it.each(['1.0.0+build.1', '1.0.0-alpha.1+sha.5114f85', '1.0.0evil', '01.0.0', '1.0', 'v1.0.0', 'latest', 'current', ''])(
		'refuses %j as a version key',
		(version) => {
			const message = `Expected a SemVer version with no build metadata, such as 1.2.0 or 1.3.0-beta.1; got "${version}"`;
			expect(itemIssues({ ...petAddendum, versions: { ...petAddendum.versions, [version]: entry } })).toEqual([
				[['versions', version], message],
			]);
			expect(RegistryVersionKeySchema.safeParse(version).success).toBe(false);
		},
	);

	it('refuses a version with build metadata as latestVersion', () => {
		expect(itemIssues({ ...petAddendum, latestVersion: '1.1.0+build.1' })).toEqual([
			[['latestVersion'], 'Expected a SemVer version with no build metadata, such as 1.2.0 or 1.3.0-beta.1'],
			[['latestVersion'], 'latestVersion "1.1.0+build.1" is not a key of versions (1.1.0, 1.0.0)'],
		]);
	});

	it.each(['latest', 'current'])('refuses %s as an edition key and as currentEdition', (key) => {
		const message = 'Expected an edition key: lowercase letters and digits with single hyphens, such as 2024-03, and not one of current, latest, editions, tags, diff';
		expect(itemIssues({ ...w9, editions: { ...w9.editions, [key]: w9.editions['2018-10'] } })).toEqual([
			[['editions', key], `${message}; got "${key}"`],
		]);
		expect(itemIssues({ ...w9, currentEdition: key })).toEqual([
			[['currentEdition'], message],
			[['currentEdition'], `currentEdition "${key}" is not a key of editions (2024-03, 2018-10)`],
		]);
	});
});

describe('rule 8: cross-field rules', () => {
	it('refuses a currentEdition that is not a key of editions', () => {
		expect(itemIssues({ ...w9, currentEdition: '2025-01' })).toEqual([
			[['currentEdition'], 'currentEdition "2025-01" is not a key of editions (2024-03, 2018-10)'],
		]);
	});

	it('accepts a currentEdition that is not the newest edition by date', () => {
		const future = { label: 'Rev. January 2030', date: '2030-01', effectiveFrom: '2030-01-01', latestVersion: '1.0.0', versions: { '1.0.0': { path: 'w-9/2030-01/1.0.0/w-9.json', sha256: sha('f') } } };
		expect(itemIssues({ ...w9, editions: { ...w9.editions, '2030-01': future } })).toEqual([]);
	});

	it("refuses an edition's latestVersion that is not a key of its versions", () => {
		expect(itemIssues(withEdition({ ...w9.editions['2024-03'], latestVersion: '2.0.0' }))).toEqual([
			[['editions', '2024-03', 'latestVersion'], 'latestVersion "2.0.0" is not a key of versions (1.1.0, 1.0.0)'],
		]);
	});

	it("refuses an item's latestVersion that is not a key of its versions", () => {
		expect(itemIssues({ ...petAddendum, latestVersion: '2.0.0' })).toEqual([
			[['latestVersion'], 'latestVersion "2.0.0" is not a key of versions (1.1.0, 1.0.0)'],
		]);
	});

	it('accepts a latestVersion that is a pre-release, or lower than another version', () => {
		const versions = { ...petAddendum.versions, '2.0.0-rc.1': { path: 'pet-addendum/2.0.0-rc.1/pet-addendum.json', sha256: sha('f') } };
		expect(itemIssues({ ...petAddendum, versions, latestVersion: '2.0.0-rc.1' })).toEqual([]);
		expect(itemIssues({ ...petAddendum, versions, latestVersion: '1.0.0' })).toEqual([]);
	});

	it('does not read an inherited property as a listed key', () => {
		expect(itemIssues({ ...w9, currentEdition: 'constructor' })).toEqual([
			[['currentEdition'], 'currentEdition "constructor" is not a key of editions (2024-03, 2018-10)'],
		]);
	});

	it('refuses two items with the same name', () => {
		const other = { ...petAddendum, name: 'w-9' };
		expect(issues(RegistryIndexSchema.safeParse(manifest(w9, petAddendum, other)))).toEqual([
			[['items', 2, 'name'], 'Duplicate item name "w-9": items[0] already has it'],
			[['items', 2, 'versions', '1.1.0', 'path'], 'Duplicate path "pet-addendum/1.1.0/pet-addendum.json": items[1].versions.1.1.0 already has it'],
			[['items', 2, 'versions', '1.0.0', 'path'], 'Duplicate path "pet-addendum/pet-addendum.json": items[1].versions.1.0.0 already has it'],
		]);
	});

	it('refuses two version entries with the same path in one item', () => {
		const versions = { ...petAddendum.versions, '1.0.0': petAddendum.versions['1.1.0'] };
		expect(issues(RegistryIndexSchema.safeParse(manifest({ ...petAddendum, versions })))).toEqual([
			[['items', 0, 'versions', '1.0.0', 'path'], 'Duplicate path "pet-addendum/1.1.0/pet-addendum.json": items[0].versions.1.1.0 already has it'],
		]);
	});

	it('refuses two version entries with the same path in two items, and in two editions', () => {
		const path = 'w-9/2024-03/1.1.0/w-9.json';
		const lease = { name: 'lease', kind: 'form', latestVersion: '1.0.0', versions: { '1.0.0': { path, sha256: sha('f') } } };
		expect(issues(RegistryIndexSchema.safeParse(manifest(w9, lease)))).toEqual([
			[['items', 1, 'versions', '1.0.0', 'path'], `Duplicate path "${path}": items[0].editions.2024-03.versions.1.1.0 already has it`],
		]);

		const editions = { ...w9.editions, '2018-10': { ...w9.editions['2018-10'], versions: { '1.0.0': { path, sha256: sha('c') } } } };
		expect(issues(RegistryIndexSchema.safeParse(manifest({ ...w9, editions })))).toEqual([
			[['items', 0, 'editions', '2018-10', 'versions', '1.0.0', 'path'], `Duplicate path "${path}": items[0].editions.2024-03.versions.1.1.0 already has it`],
		]);
	});

	it('reports the fault of an item that broke the editions-or-versions rule, and still checks the rest', () => {
		const neither = { name: 'w-9', kind: 'form' };
		const half = { name: 'w-9', kind: 'form', currentEdition: '2024-03' };
		const both = { ...w9, name: 'lease', versions: { '1.0.0': petAddendum.versions['1.0.0'] } };
		expect(issues(RegistryIndexSchema.safeParse(manifest(neither, half, petAddendum, both)))).toEqual([
			[['items', 0], REGISTRY_ITEM_RELEASES_RULE],
			[['items', 1, 'editions'], 'Required with currentEdition: list the editions'],
			[['items', 3, 'versions'], REGISTRY_ITEM_EDITIONS_ONLY_RULE],
			[['items', 1, 'name'], 'Duplicate item name "w-9": items[0] already has it'],
			[['items', 3, 'versions', '1.0.0', 'path'], 'Duplicate path "pet-addendum/pet-addendum.json": items[2].versions.1.0.0 already has it'],
		]);
	});

	it('accepts the same sha256 at two paths', () => {
		const versions = { '1.1.0': { path: 'a.json', sha256: sha('a') }, '1.0.0': { path: 'b.json', sha256: sha('a') } };
		expect(issues(RegistryIndexSchema.safeParse(manifest({ ...petAddendum, versions })))).toEqual([]);
	});
});

describe('rule 9: item names are lowercase slugs', () => {
	it.each(['w9', 'w-9', 'form-1040-sr', '1099', 'a'.repeat(128)])('accepts %s', (name) => {
		expect(itemIssues({ ...petAddendum, name })).toEqual([]);
	});

	it.each(['W-9', 'Form', 'my_form', 'a--b', '-a', 'a-', 'a.b', 'a/b', '@acme/w-9', ' w-9'])('refuses %s', (name) => {
		expect(itemIssues({ ...petAddendum, name })).toEqual([
			[['name'], 'Expected an artifact name: lowercase letters and digits with single hyphens, such as w-9'],
		]);
	});

	it('refuses an empty name and a name of more than 128 characters', () => {
		expect(RegistryItemNameSchema.safeParse('').success).toBe(false);
		expect(itemIssues({ ...petAddendum, name: 'a'.repeat(129) })).toEqual([
			[['name'], 'Too big: expected string to have <=128 characters'],
		]);
	});
});

describe('rule 10: artifactsPath is removed', () => {
	it('refuses artifactsPath', () => {
		expect(issues(RegistryIndexSchema.safeParse({ ...manifest(w9), artifactsPath: '/r' }))).toEqual([
			[[], 'Unrecognized key: "artifactsPath"'],
		]);
	});
});

describe('rule 11: the other item fields stay', () => {
	it('keeps kind, title, description, layers and tags', () => {
		const item = { ...petAddendum, title: 'Pet Addendum', description: 'For a lease', layers: ['pdf', 'markdown'], tags: ['lease'] };
		expect(RegistryItemSummarySchema.parse(item)).toEqual(item);
	});

	it.each(['form', 'document', 'checklist', 'bundle'])('accepts the kind %s', (kind) => {
		expect(itemIssues({ ...petAddendum, kind })).toEqual([]);
	});

	it('refuses an unknown kind, an empty tag and an item property it does not define', () => {
		expect(itemIssues({ ...petAddendum, kind: 'template' })[0]?.[0]).toEqual(['kind']);
		expect(itemIssues({ ...petAddendum, tags: [''] })[0]?.[0]).toEqual(['tags', 0]);
		expect(itemIssues({ ...petAddendum, edition: { key: '2024-03', label: 'x' } })).toEqual([
			[[], 'Unrecognized key: "edition"'],
		]);
	});
});
