/**
 * The shared release resolver and the release list: what every reader of a
 * file registry uses to turn a request into one release of a manifest item.
 */
import { describe, expect, it } from 'vitest';
import {
	RegistryItemSummarySchema,
	describeRegistryReleaseFailure,
	listRegistryReleases,
	resolveRegistryRelease,
	type RegistryItemSummary,
} from '../src/zod';

const sha = (digit: string) => digit.repeat(64);

const w9: RegistryItemSummary = RegistryItemSummarySchema.parse({
	name: 'w-9',
	kind: 'form',
	// The current edition is neither the first key nor the newest by date.
	currentEdition: '2024-03',
	editions: {
		'2018-10': {
			label: 'Rev. October 2018',
			date: '2018-10',
			latestVersion: '1.0.0',
			versions: { '1.0.0': { path: 'w-9/2018-10/1.0.0/w-9.json', sha256: sha('c') } },
		},
		'2030-01': {
			label: 'Rev. January 2030',
			effectiveFrom: '2030-01-01',
			latestVersion: '1.0.0',
			versions: { '1.0.0': { path: 'w-9/2030-01/1.0.0/w-9.json', sha256: sha('f') } },
		},
		'2024-03': {
			label: 'Rev. March 2024',
			date: '2024-03',
			// The latest version is neither the first key nor the highest version.
			latestVersion: '1.1.0',
			versions: {
				'1.0.0': { path: 'w-9/2024-03/1.0.0/w-9.json', sha256: sha('b') },
				'2.0.0-rc.1': { path: 'w-9/2024-03/2.0.0-rc.1/w-9.json', sha256: sha('e') },
				'1.1.0': { path: 'w-9/2024-03/1.1.0/w-9.json', sha256: sha('a') },
				'1.10.0-beta': { path: 'w-9/2024-03/1.10.0-beta/w-9.json', sha256: sha('9') },
			},
		},
	},
});

const petAddendum: RegistryItemSummary = RegistryItemSummarySchema.parse({
	name: 'pet-addendum',
	kind: 'form',
	latestVersion: '1.1.0',
	versions: {
		'1.0.0': { path: 'pet-addendum/pet-addendum.json', sha256: sha('e') },
		'1.2.0-beta.1': { path: 'pet-addendum/1.2.0-beta.1/pet-addendum.json', sha256: sha('1') },
		'1.1.0': { path: 'pet-addendum/1.1.0/pet-addendum.json', sha256: sha('d') },
	},
});

const march2024 = { key: '2024-03', label: 'Rev. March 2024', date: '2024-03' };

describe('resolveRegistryRelease: an artifact that has editions', () => {
	const defaultRelease = {
		ok: true,
		release: { edition: march2024, version: '1.1.0', path: 'w-9/2024-03/1.1.0/w-9.json', sha256: sha('a') },
	};

	it.each([
		['no request', undefined],
		['an empty request', {}],
		['the selector current', { edition: 'current' }],
		['the selector latest', { version: 'latest' }],
		['both selectors', { edition: 'current', version: 'latest' }],
	])('gives the current edition and its latest version for %s', (_case, request) => {
		expect(resolveRegistryRelease(w9, request)).toEqual(defaultRelease);
	});

	it('gives the latest version of a named edition, with only the facts the edition states', () => {
		expect(resolveRegistryRelease(w9, { edition: '2018-10' })).toEqual({
			ok: true,
			release: {
				edition: { key: '2018-10', label: 'Rev. October 2018', date: '2018-10' },
				version: '1.0.0',
				path: 'w-9/2018-10/1.0.0/w-9.json',
				sha256: sha('c'),
			},
		});
		const future = resolveRegistryRelease(w9, { edition: '2030-01', version: 'latest' });
		expect(future.ok && future.release.edition).toEqual({ key: '2030-01', label: 'Rev. January 2030', effectiveFrom: '2030-01-01' });
		expect(future.ok && future.release.edition && 'date' in future.release.edition).toBe(false);
	});

	it('gives a named version of the current edition', () => {
		expect(resolveRegistryRelease(w9, { version: '1.0.0' })).toEqual({
			ok: true,
			release: { edition: march2024, version: '1.0.0', path: 'w-9/2024-03/1.0.0/w-9.json', sha256: sha('b') },
		});
		expect(resolveRegistryRelease(w9, { edition: 'current', version: '2.0.0-rc.1' })).toMatchObject({
			ok: true,
			release: { version: '2.0.0-rc.1', sha256: sha('e') },
		});
	});

	it('gives an exact edition and version', () => {
		expect(resolveRegistryRelease(w9, { edition: '2024-03', version: '1.0.0' })).toMatchObject({
			ok: true,
			release: { edition: march2024, version: '1.0.0' },
		});
	});

	it('uses the stated defaults, never the newest date or the highest version', () => {
		const resolved = resolveRegistryRelease(w9);
		expect(resolved.ok && resolved.release.edition?.key).toBe('2024-03');
		expect(resolved.ok && resolved.release.version).toBe('1.1.0');
	});

	it.each(['2019-01', 'latest', 'Rev. March 2024', 'constructor', '__proto__', ''])(
		'fails for the unknown edition %j and lists the editions',
		(edition) => {
			expect(resolveRegistryRelease(w9, { edition, version: '1.0.0' })).toEqual({
				ok: false,
				failure: {
					code: 'unknown-edition',
					name: 'w-9',
					edition,
					currentEdition: '2024-03',
					editions: ['2024-03', '2030-01', '2018-10'],
				},
			});
		},
	);

	it.each(['3.0.0', '1.1.0+build.1', 'current', 'toString', '__proto__', ''])(
		'fails for the unknown version %j and lists the versions of that edition',
		(version) => {
			expect(resolveRegistryRelease(w9, { version })).toEqual({
				ok: false,
				failure: {
					code: 'unknown-version',
					name: 'w-9',
					edition: '2024-03',
					version,
					latestVersion: '1.1.0',
					versions: ['1.1.0', '2.0.0-rc.1', '1.10.0-beta', '1.0.0'],
				},
			});
		},
	);

	it('searches only the named edition for a version', () => {
		expect(resolveRegistryRelease(w9, { edition: '2018-10', version: '1.1.0' })).toEqual({
			ok: false,
			failure: { code: 'unknown-version', name: 'w-9', edition: '2018-10', version: '1.1.0', latestVersion: '1.0.0', versions: ['1.0.0'] },
		});
	});
});

describe('resolveRegistryRelease: an artifact that has no editions', () => {
	it.each([
		['no request', undefined],
		['the selector current', { edition: 'current' }],
		['both selectors', { edition: 'current', version: 'latest' }],
	])('gives the latest version and a null edition for %s', (_case, request) => {
		expect(resolveRegistryRelease(petAddendum, request)).toEqual({
			ok: true,
			release: { edition: null, version: '1.1.0', path: 'pet-addendum/1.1.0/pet-addendum.json', sha256: sha('d') },
		});
	});

	it('gives a named version', () => {
		expect(resolveRegistryRelease(petAddendum, { version: '1.0.0' })).toEqual({
			ok: true,
			release: { edition: null, version: '1.0.0', path: 'pet-addendum/pet-addendum.json', sha256: sha('e') },
		});
	});

	it('fails when an edition is named, and lists the versions', () => {
		expect(resolveRegistryRelease(petAddendum, { edition: '2024-03', version: '1.0.0' })).toEqual({
			ok: false,
			failure: { code: 'no-editions', name: 'pet-addendum', edition: '2024-03', versions: ['1.1.0', '1.2.0-beta.1', '1.0.0'] },
		});
	});

	it('fails for an unknown version with a null edition, and lists the versions', () => {
		expect(resolveRegistryRelease(petAddendum, { version: '9.9.9' })).toEqual({
			ok: false,
			failure: {
				code: 'unknown-version',
				name: 'pet-addendum',
				edition: null,
				version: '9.9.9',
				latestVersion: '1.1.0',
				versions: ['1.1.0', '1.2.0-beta.1', '1.0.0'],
			},
		});
	});
});

describe('describeRegistryReleaseFailure', () => {
	const describeFailure = (item: RegistryItemSummary, request: { edition?: string; version?: string }) => {
		const resolved = resolveRegistryRelease(item, request);
		return resolved.ok ? undefined : describeRegistryReleaseFailure(resolved.failure);
	};

	it('says what was named and what exists, for each failure', () => {
		expect(describeFailure(petAddendum, { edition: '2024-03' })).toBe(
			'pet-addendum has no editions, so it has no edition 2024-03. Its versions: 1.1.0, 1.2.0-beta.1, 1.0.0.',
		);
		expect(describeFailure(w9, { edition: '2019-01' })).toBe(
			'w-9 has no edition 2019-01. Its editions: 2024-03, 2030-01, 2018-10 (current: 2024-03).',
		);
		expect(describeFailure(w9, { edition: '2018-10', version: '2.0.0' })).toBe(
			'Edition 2018-10 of w-9 has no version 2.0.0. Its versions: 1.0.0 (latest: 1.0.0).',
		);
		expect(describeFailure(petAddendum, { version: '2.0.0' })).toBe(
			'pet-addendum has no version 2.0.0. Its versions: 1.1.0, 1.2.0-beta.1, 1.0.0 (latest: 1.1.0).',
		);
	});
});

describe('listRegistryReleases', () => {
	it('lists the current edition first, then the others by key from the highest down', () => {
		const groups = listRegistryReleases(w9);
		expect(groups.map((group) => [group.edition?.key, group.isCurrent, group.latestVersion])).toEqual([
			['2024-03', true, '1.1.0'],
			['2030-01', false, '1.0.0'],
			['2018-10', false, '1.0.0'],
		]);
		expect(groups[0]?.edition).toEqual(march2024);
		expect(groups[1]?.edition).toEqual({ key: '2030-01', label: 'Rev. January 2030', effectiveFrom: '2030-01-01' });
	});

	it('lists the latest version first, then the others by SemVer precedence from the highest down', () => {
		expect(listRegistryReleases(w9)[0]?.versions).toEqual([
			{ version: '1.1.0', path: 'w-9/2024-03/1.1.0/w-9.json', sha256: sha('a'), isLatest: true },
			{ version: '2.0.0-rc.1', path: 'w-9/2024-03/2.0.0-rc.1/w-9.json', sha256: sha('e'), isLatest: false },
			{ version: '1.10.0-beta', path: 'w-9/2024-03/1.10.0-beta/w-9.json', sha256: sha('9'), isLatest: false },
			{ version: '1.0.0', path: 'w-9/2024-03/1.0.0/w-9.json', sha256: sha('b'), isLatest: false },
		]);
	});

	it('gives one group with a null edition for an artifact that has none', () => {
		expect(listRegistryReleases(petAddendum)).toEqual([
			{
				edition: null,
				isCurrent: true,
				latestVersion: '1.1.0',
				versions: [
					{ version: '1.1.0', path: 'pet-addendum/1.1.0/pet-addendum.json', sha256: sha('d'), isLatest: true },
					{ version: '1.2.0-beta.1', path: 'pet-addendum/1.2.0-beta.1/pet-addendum.json', sha256: sha('1'), isLatest: false },
					{ version: '1.0.0', path: 'pet-addendum/pet-addendum.json', sha256: sha('e'), isLatest: false },
				],
			},
		]);
	});

	it('gives the same order whatever the order of the keys in the manifest', () => {
		if (w9.editions === undefined) throw new Error('w9 has editions');
		const reversedEditions = Object.fromEntries(
			Object.entries(w9.editions).reverse().map(([key, edition]) => [
				key,
				{ ...edition, versions: Object.fromEntries(Object.entries(edition.versions).reverse()) },
			]),
		);
		expect(listRegistryReleases({ ...w9, editions: reversedEditions })).toEqual(listRegistryReleases(w9));
	});

	it('puts first the release that an empty request resolves to', () => {
		for (const item of [w9, petAddendum]) {
			const resolved = resolveRegistryRelease(item);
			const first = listRegistryReleases(item)[0];
			expect(resolved.ok && resolved.release.edition).toEqual(first?.edition);
			expect(resolved.ok && resolved.release.version).toBe(first?.versions[0]?.version);
		}
	});
});
