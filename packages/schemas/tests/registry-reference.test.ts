/**
 * File registry references: `@ns/name[/edition][@version]`. The edition and
 * version tail is the tail of the platform coordinate grammar.
 */
import { describe, expect, it } from 'vitest';
import {
	REGISTRY_REFERENCE_PATTERN,
	formatArtifactCoordinate,
	formatRegistryReference,
	parseArtifactCoordinate,
	parseRegistryReference,
} from '../src/zod';

describe('parseRegistryReference', () => {
	it.each([
		['@acme/w-9', { namespace: '@acme', name: 'w-9' }],
		['@acme/w-9/2024-03', { namespace: '@acme', name: 'w-9', edition: '2024-03' }],
		['@acme/w-9@1.0.0', { namespace: '@acme', name: 'w-9', version: '1.0.0' }],
		['@acme/w-9/2024-03@1.0.0', { namespace: '@acme', name: 'w-9', edition: '2024-03', version: '1.0.0' }],
		['@acme/w-9/3b@2.0.0-rc.1', { namespace: '@acme', name: 'w-9', edition: '3b', version: '2.0.0-rc.1' }],
		['@acme/w-9@1.0.0+build.5', { namespace: '@acme', name: 'w-9', version: '1.0.0+build.5' }],
		['@My_Org-1/1099', { namespace: '@My_Org-1', name: '1099' }],
	])('parses %s', (reference, expected) => {
		expect(parseRegistryReference(reference)).toEqual(expected);
		expect(REGISTRY_REFERENCE_PATTERN.test(reference)).toBe(true);
	});

	it.each([
		['@acme/w-9/current', { namespace: '@acme', name: 'w-9' }],
		['@acme/w-9@latest', { namespace: '@acme', name: 'w-9' }],
		['@acme/w-9/current@latest', { namespace: '@acme', name: 'w-9' }],
		['@acme/w-9/current@1.0.0', { namespace: '@acme', name: 'w-9', version: '1.0.0' }],
		['@acme/w-9/2024-03@latest', { namespace: '@acme', name: 'w-9', edition: '2024-03' }],
	])('normalizes the selectors in %s to absent', (reference, expected) => {
		const parsed = parseRegistryReference(reference);
		expect(parsed).toEqual(expected);
		expect(parsed && 'edition' in parsed).toBe('edition' in expected);
		expect(parsed && 'version' in parsed).toBe('version' in expected);
	});

	it.each([
		['no leading @', 'acme/w-9'],
		['no name', '@acme'],
		['an empty name', '@acme/'],
		['an empty namespace', '@/w-9'],
		['a namespace with a dot', '@acme.com/w-9'],
		['a namespace with another character', '@acme!/w-9'],
		['a capital letter in the name', '@acme/W-9'],
		['an underscore in the name', '@acme/my_form'],
		['a trailing hyphen in the name', '@acme/w-9-'],
		['a double hyphen in the name', '@acme/a--b'],
		['a name of more than 128 characters', `@acme/${'a'.repeat(129)}`],
		['a name of more than 128 characters before an edition', `@acme/${'a'.repeat(129)}/2024-03`],
		['a name of more than 128 characters before a version', `@acme/${'a'.repeat(129)}@1.0.0`],
		['the reserved word latest as the edition', '@acme/w-9/latest'],
		['the reserved word editions as the edition', '@acme/w-9/editions'],
		['the reserved word tags as the edition', '@acme/w-9/tags@1.0.0'],
		['the reserved word diff as the edition', '@acme/w-9/diff'],
		['a capital letter in the edition', '@acme/w-9/3B'],
		['a dot in the edition', '@acme/w-9/rev.2024'],
		['an edition of more than 64 characters', `@acme/w-9/${'a'.repeat(65)}`],
		['an empty edition', '@acme/w-9/'],
		['a fifth segment', '@acme/w-9/2024-03/1.0.0'],
		['an empty version', '@acme/w-9@'],
		['a partial version', '@acme/w-9@1.0'],
		['a version range', '@acme/w-9@^1.0.0'],
		['a version with a v', '@acme/w-9@v1.0.0'],
		['the word current as the version', '@acme/w-9@current'],
		['the version before the edition', '@acme/w-9@1.0.0/2024-03'],
		['two versions', '@acme/w-9@1.0.0@1.0.1'],
		['a trailing space', '@acme/w-9 '],
		['a trailing newline', '@acme/w-9\n'],
		['an empty string', ''],
	])('refuses %s', (_case, reference) => {
		expect(parseRegistryReference(reference)).toBeUndefined();
		expect(REGISTRY_REFERENCE_PATTERN.test(reference)).toBe(false);
	});

	it('accepts a name of 128 characters and an edition of 64', () => {
		const reference = `@acme/${'a'.repeat(128)}/${'b'.repeat(64)}@1.0.0`;
		expect(parseRegistryReference(reference)).toEqual({ namespace: '@acme', name: 'a'.repeat(128), edition: 'b'.repeat(64), version: '1.0.0' });
		expect(REGISTRY_REFERENCE_PATTERN.test(reference)).toBe(true);
	});
});

describe('formatRegistryReference', () => {
	it.each([
		'@acme/w-9',
		'@acme/w-9/2024-03',
		'@acme/w-9@1.0.0',
		'@acme/w-9/2024-03@1.0.0',
		'@My_Org-1/1099/3b@2.0.0-rc.1',
	])('is the inverse of the parser for %s', (reference) => {
		const parsed = parseRegistryReference(reference);
		expect(parsed).toBeDefined();
		if (!parsed) return;
		expect(formatRegistryReference(parsed)).toBe(reference);
		expect(parseRegistryReference(formatRegistryReference(parsed))).toEqual(parsed);
	});

	it('never writes the selectors', () => {
		const parsed = parseRegistryReference('@acme/w-9/current@latest');
		expect(parsed && formatRegistryReference(parsed)).toBe('@acme/w-9');
	});

	it('formats parts that a caller builds', () => {
		expect(formatRegistryReference({ namespace: '@acme', name: 'w-9', edition: '2024-03', version: '1.1.0' })).toBe('@acme/w-9/2024-03@1.1.0');
		expect(formatRegistryReference({ namespace: '@acme', name: 'w-9', version: '1.1.0' })).toBe('@acme/w-9@1.1.0');
	});
});

describe('the tail is shared with the platform coordinate grammar', () => {
	const tails = ['', '/2024-03', '@1.0.0', '/2024-03@1.0.0', '/current', '@latest', '/current@latest', '/3b@2.0.0-rc.1+build'];
	const badTails = ['/latest', '/editions', '/3B', '@1.0', '@', '/', `/${'a'.repeat(65)}`, '/2024-03/1.0.0'];

	it.each(tails)('both grammars parse the tail %j to the same edition and version', (tail) => {
		const reference = parseRegistryReference(`@acme/w-9${tail}`);
		const coordinate = parseArtifactCoordinate(`@acme/irs/w-9${tail}`);
		expect(reference).toBeDefined();
		expect({ edition: reference?.edition, version: reference?.version }).toEqual({
			edition: coordinate?.edition,
			version: coordinate?.version,
		});
		if (reference && coordinate) {
			expect(formatArtifactCoordinate(coordinate).slice('@acme/irs/w-9'.length)).toBe(
				formatRegistryReference(reference).slice('@acme/w-9'.length),
			);
		}
	});

	it.each(badTails)('both grammars refuse the tail %j', (tail) => {
		expect(parseRegistryReference(`@acme/w-9${tail}`)).toBeUndefined();
		expect(parseArtifactCoordinate(`@acme/irs/w-9${tail}`)).toBeUndefined();
	});
});
