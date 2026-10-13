/** The SemVer 2.0.0 core and optional prerelease: `1.2.3` or `1.2.3-rc.1`. */
const CORE_AND_PRERELEASE_SOURCE =
	'(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?';

/** The optional SemVer 2.0.0 build metadata: `+build.5`. */
const BUILD_METADATA_SOURCE = '(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?';

/**
 * Artifact version pattern
 *
 * A full SemVer 2.0.0 version, anchored at both ends. Prerelease and build
 * metadata are allowed; leading zeros and trailing text are not. It is the one
 * version rule for artifacts, registry items, the CLI and the platform
 * registry.
 */
export const ARTIFACT_VERSION_PATTERN = new RegExp(`^${CORE_AND_PRERELEASE_SOURCE}${BUILD_METADATA_SOURCE}$`);

/**
 * Registry version key pattern
 *
 * `ARTIFACT_VERSION_PATTERN` without build metadata: the version a registry
 * manifest lists a release under. Two versions that differ only in build
 * metadata have the same SemVer precedence, so a manifest could not say which
 * of them is the later one. A prerelease is allowed.
 */
export const REGISTRY_VERSION_PATTERN = new RegExp(`^${CORE_AND_PRERELEASE_SOURCE}$`);

interface ParsedVersion {
	readonly core: readonly [string, string, string];
	readonly prerelease: readonly string[];
}

function parseVersion(version: string): ParsedVersion | undefined {
	const match = ARTIFACT_VERSION_PATTERN.exec(version);
	if (!match) return undefined;
	const prerelease = match[4];
	return {
		core: [match[1] as string, match[2] as string, match[3] as string],
		prerelease: prerelease === undefined ? [] : prerelease.split('.'),
	};
}

const NUMERIC_IDENTIFIER = /^\d+$/;

/** Compare two numbers written with no leading zeros, of any length. */
function compareNumeric(a: string, b: string): number {
	if (a.length !== b.length) return a.length < b.length ? -1 : 1;
	return compareText(a, b);
}

/** Compare two strings by code unit, which is ASCII order for SemVer identifiers. */
function compareText(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
	// A version with no prerelease is later than the same version with one.
	if (a.length === 0 || b.length === 0) return b.length - a.length;
	for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
		const left = a[i] as string;
		const right = b[i] as string;
		const leftNumeric = NUMERIC_IDENTIFIER.test(left);
		const rightNumeric = NUMERIC_IDENTIFIER.test(right);
		// A numeric identifier is earlier than an alphanumeric one.
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
		const order = leftNumeric ? compareNumeric(left, right) : compareText(left, right);
		if (order !== 0) return order;
	}
	// With equal leading identifiers, the longer prerelease is later.
	return a.length - b.length;
}

/**
 * Compare two versions by SemVer 2.0.0 precedence: negative when `a` is
 * earlier than `b`, positive when it is later, and zero when they have the
 * same precedence. Build metadata is ignored, as SemVer requires, so
 * `1.0.0+a` and `1.0.0+b` compare as equal.
 *
 * It never throws. A string that is not a SemVer version is earlier than
 * every version, and two such strings compare by code unit, so a sort that
 * uses it is always stable and total.
 */
export function compareArtifactVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) {
		if (!left && !right) return compareText(a, b);
		return left ? 1 : -1;
	}
	for (let i = 0; i < 3; i += 1) {
		const order = compareNumeric(left.core[i] as string, right.core[i] as string);
		if (order !== 0) return order;
	}
	return Math.sign(comparePrerelease(left.prerelease, right.prerelease));
}
