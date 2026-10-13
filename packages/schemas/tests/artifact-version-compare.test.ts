import { describe, expect, it } from 'vitest';
import { ARTIFACT_VERSION_PATTERN, REGISTRY_VERSION_PATTERN, compareArtifactVersions } from '../src/zod';

const sortAscending = (versions: string[]) => [...versions].sort(compareArtifactVersions);

/** Three other orders of a list, so a sort cannot pass by luck of the input order. */
function shuffles(list: string[]): string[][] {
	return [[...list].reverse(), [...list.slice(3), ...list.slice(0, 3)], list.filter((_, i) => i % 2).concat(list.filter((_, i) => i % 2 === 0))];
}

describe('compareArtifactVersions: SemVer 2.0.0 precedence', () => {
	it('orders the core example of the specification: 1.0.0 < 2.0.0 < 2.1.0 < 2.1.1', () => {
		const ordered = ['1.0.0', '2.0.0', '2.1.0', '2.1.1'];
		for (const shuffled of shuffles(ordered)) expect(sortAscending(shuffled)).toEqual(ordered);
	});

	it('orders the pre-release example of the specification', () => {
		const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
		for (const shuffled of shuffles(ordered)) expect(sortAscending(shuffled)).toEqual(ordered);
	});

	it.each([
		['a pre-release is earlier than its release', '1.0.0-alpha', '1.0.0'],
		['a release is later than the pre-release of the next version', '1.0.0', '1.0.1-alpha'],
		['core numbers compare as numbers, not text', '1.9.0', '1.10.0'],
		['major is compared before minor', '1.99.99', '2.0.0'],
		['minor is compared before patch', '1.1.99', '1.2.0'],
		['numeric identifiers compare as numbers', '1.0.0-2', '1.0.0-11'],
		['a numeric identifier is earlier than an alphanumeric one', '1.0.0-999', '1.0.0-a'],
		['a numeric identifier is earlier than one with a hyphen', '1.0.0-1', '1.0.0--'],
		['alphanumeric identifiers compare in ASCII order', '1.0.0-Beta', '1.0.0-alpha'],
		['alphanumeric identifiers that begin with digits compare as text', '1.0.0-11a', '1.0.0-2a'],
		['a longer pre-release is later when the leading identifiers are equal', '1.0.0-alpha.1', '1.0.0-alpha.1.0'],
		['an earlier identifier decides before length', '1.0.0-alpha.1.5', '1.0.0-alpha.2'],
		['numbers beyond the safe integer range compare exactly', '1.0.0-9007199254740993', '1.0.0-9007199254740994'],
		['a longer number is later than a shorter one', '99999999999999999999.0.0', '100000000000000000000.0.0'],
	])('%s: %s < %s', (_rule, earlier, later) => {
		expect(compareArtifactVersions(earlier, later)).toBe(-1);
		expect(compareArtifactVersions(later, earlier)).toBe(1);
	});

	it.each([
		['1.0.0', '1.0.0'],
		['1.0.0-rc.1', '1.0.0-rc.1'],
		['1.0.0+build.1', '1.0.0+build.2'],
		['1.0.0+build.1', '1.0.0'],
		['1.0.0-rc.1+a', '1.0.0-rc.1+b'],
	])('gives %s and %s the same precedence', (a, b) => {
		expect(compareArtifactVersions(a, b)).toBe(0);
		expect(compareArtifactVersions(b, a)).toBe(0);
	});

	it('never throws: a string that is not a version is earlier than every version', () => {
		expect(compareArtifactVersions('latest', '0.0.0-0')).toBe(-1);
		expect(compareArtifactVersions('0.0.0-0', 'latest')).toBe(1);
		expect(compareArtifactVersions('1.0', '01.0.0')).toBe(1);
		expect(compareArtifactVersions('01.0.0', '1.0')).toBe(-1);
		expect(compareArtifactVersions('', '')).toBe(0);
		expect(sortAscending(['1.0.0', 'x', '0.1.0', 'a'])).toEqual(['a', 'x', '0.1.0', '1.0.0']);
	});
});

describe('the version patterns', () => {
	it('keeps the artifact version pattern exactly as published', () => {
		expect(ARTIFACT_VERSION_PATTERN.source).toBe(
			String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$`,
		);
	});

	const versions = ['1.0.0', '0.0.0', '10.20.30', '1.0.0-beta', '1.0.0-rc.1', '1.0.0+build.1', '1.0.0-alpha.1+sha.5114f85', '1.0.0evil', '01.0.0', '1.0', '1.0.0-', '1.0.0+', '1.0.0-01', 'latest', 'current', ''];

	it.each(versions)('the registry version pattern accepts %j only when it is an artifact version with no build metadata', (version) => {
		expect(REGISTRY_VERSION_PATTERN.test(version)).toBe(ARTIFACT_VERSION_PATTERN.test(version) && !version.includes('+'));
	});

	it('the registry version pattern accepts a pre-release and refuses build metadata', () => {
		expect(REGISTRY_VERSION_PATTERN.test('1.0.0-rc.1')).toBe(true);
		expect(REGISTRY_VERSION_PATTERN.test('1.0.0+build.1')).toBe(false);
	});
});
