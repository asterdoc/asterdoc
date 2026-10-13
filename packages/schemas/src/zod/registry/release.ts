/**
 * Registry releases
 *
 * A release is one version of one edition of an artifact, or one version of
 * an artifact that has no editions. These functions read a parsed manifest
 * item (`RegistryItemSummary`); every reader of a file registry shares them,
 * so a request resolves to the same release everywhere.
 *
 * They are pure: no network, no file access, and they never throw for a
 * request that names something the manifest does not list.
 */

import { CURRENT_EDITION, LATEST_VERSION } from '../primitives/artifact-coordinate';
import { compareArtifactVersions } from '../primitives/version';
import type { RegistryEditionEntry, RegistryItemSummary, RegistryVersions } from './registry-index';

/** The edition of a release: its key and the facts the issuer prints. */
export interface RegistryReleaseEdition {
	readonly key: string;
	readonly label: string;
	readonly date?: string;
	readonly effectiveFrom?: string;
}

/** One release of an artifact, as a manifest lists it. */
export interface RegistryRelease {
	/** The edition of the release, or `null` for an artifact that has no editions. */
	readonly edition: RegistryReleaseEdition | null;
	readonly version: string;
	/** The path of the artifact file, relative to the registry base address. */
	readonly path: string;
	/** SHA-256 digest of the artifact file, as 64 lowercase hex digits. */
	readonly sha256: string;
}

/** The release a request names. Each part is optional. */
export interface RegistryReleaseRequest {
	/** An edition key. Omitted, or `current`: the item's `currentEdition`. */
	readonly edition?: string;
	/** A version. Omitted, or `latest`: the `latestVersion` of the edition, or of the item. */
	readonly version?: string;
}

/**
 * Why a request names no release of an item, with what the item does list.
 *
 * - `no-editions`: the request names an edition, and the artifact has none.
 * - `unknown-edition`: the artifact has editions, and none has that key.
 * - `unknown-version`: the edition (or the artifact, when `edition` is
 *   `null`) does not list that version.
 */
export type RegistryReleaseFailure =
	| {
		readonly code: 'no-editions';
		readonly name: string;
		readonly edition: string;
		/** The versions the artifact lists, latest first. */
		readonly versions: readonly string[];
	}
	| {
		readonly code: 'unknown-edition';
		readonly name: string;
		readonly edition: string;
		readonly currentEdition: string;
		/** The edition keys the artifact lists, current first. */
		readonly editions: readonly string[];
	}
	| {
		readonly code: 'unknown-version';
		readonly name: string;
		/** The edition that was searched, or `null` for an artifact that has no editions. */
		readonly edition: string | null;
		readonly version: string;
		readonly latestVersion: string;
		/** The versions that edition (or the artifact) lists, latest first. */
		readonly versions: readonly string[];
	};

/** The result of resolving a request: the release, or the reason there is none. */
export type RegistryReleaseResolution =
	| { readonly ok: true; readonly release: RegistryRelease }
	| { readonly ok: false; readonly failure: RegistryReleaseFailure };

/** One version in a release list. */
export interface RegistryListedVersion {
	readonly version: string;
	readonly path: string;
	readonly sha256: string;
	/** Whether this is the `latestVersion` of its edition, or of the item. */
	readonly isLatest: boolean;
}

/** The versions of one edition, or of an artifact that has no editions, for display. */
export interface RegistryReleaseGroup {
	/** The edition, or `null` for an artifact that has no editions. */
	readonly edition: RegistryReleaseEdition | null;
	/** Whether this is the item's `currentEdition`. Always true when `edition` is `null`. */
	readonly isCurrent: boolean;
	readonly latestVersion: string;
	/** The latest version first, then the others from the highest SemVer precedence down. */
	readonly versions: readonly RegistryListedVersion[];
}

const isOwnKey = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** The given key first, then the other keys by `compare`, highest first. */
function orderKeys(keys: string[], first: string, compare: (a: string, b: string) => number): string[] {
	return [...keys].sort((a, b) => {
		if (a === first || b === first) return a === b ? 0 : a === first ? -1 : 1;
		return compare(b, a);
	});
}

const compareKeys = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

const orderVersions = (versions: RegistryVersions, latestVersion: string) =>
	orderKeys(Object.keys(versions), latestVersion, compareArtifactVersions);

function releaseEdition(key: string, entry: RegistryEditionEntry): RegistryReleaseEdition {
	return {
		key,
		label: entry.label,
		...(entry.date !== undefined && { date: entry.date }),
		...(entry.effectiveFrom !== undefined && { effectiveFrom: entry.effectiveFrom }),
	};
}

/**
 * Resolve a request to one release of a manifest item.
 *
 * - No edition, or `current`: the item's `currentEdition`. On an artifact
 *   that has no editions it means the artifact itself, so it never fails.
 * - No version, or `latest`: the `latestVersion` of that edition, or of the
 *   item.
 * - Anything else must be a key the item lists.
 *
 * It reads the publisher's `currentEdition` and `latestVersion` and never
 * compares dates or version numbers. It returns a failure, and never throws,
 * for a request the item does not list.
 */
export function resolveRegistryRelease(
	item: RegistryItemSummary,
	request: RegistryReleaseRequest = {},
): RegistryReleaseResolution {
	const requestedEdition = request.edition === CURRENT_EDITION ? undefined : request.edition;
	const requestedVersion = request.version === LATEST_VERSION ? undefined : request.version;

	let edition: RegistryReleaseEdition | null = null;
	let versions: RegistryVersions;
	let latestVersion: string;

	if (item.editions === undefined) {
		if (requestedEdition !== undefined) {
			return {
				ok: false,
				failure: {
					code: 'no-editions',
					name: item.name,
					edition: requestedEdition,
					versions: orderVersions(item.versions, item.latestVersion),
				},
			};
		}
		versions = item.versions;
		latestVersion = item.latestVersion;
	} else {
		const key = requestedEdition ?? item.currentEdition;
		const entry = isOwnKey(item.editions, key) ? item.editions[key] : undefined;
		if (entry === undefined) {
			return {
				ok: false,
				failure: {
					code: 'unknown-edition',
					name: item.name,
					edition: key,
					currentEdition: item.currentEdition,
					editions: orderKeys(Object.keys(item.editions), item.currentEdition, compareKeys),
				},
			};
		}
		edition = releaseEdition(key, entry);
		versions = entry.versions;
		latestVersion = entry.latestVersion;
	}

	const version = requestedVersion ?? latestVersion;
	const entry = isOwnKey(versions, version) ? versions[version] : undefined;
	if (entry === undefined) {
		return {
			ok: false,
			failure: {
				code: 'unknown-version',
				name: item.name,
				edition: edition === null ? null : edition.key,
				version,
				latestVersion,
				versions: orderVersions(versions, latestVersion),
			},
		};
	}

	return { ok: true, release: { edition, version, path: entry.path, sha256: entry.sha256 } };
}

/**
 * One sentence that says what a failed request named and what the item
 * lists, for an error a person reads.
 */
export function describeRegistryReleaseFailure(failure: RegistryReleaseFailure): string {
	switch (failure.code) {
		case 'no-editions':
			return `${failure.name} has no editions, so it has no edition ${failure.edition}. Its versions: ${failure.versions.join(', ')}.`;
		case 'unknown-edition':
			return `${failure.name} has no edition ${failure.edition}. Its editions: ${failure.editions.join(', ')} (current: ${failure.currentEdition}).`;
		case 'unknown-version': {
			const owner = failure.edition === null ? failure.name : `Edition ${failure.edition} of ${failure.name}`;
			return `${owner} has no version ${failure.version}. Its versions: ${failure.versions.join(', ')} (latest: ${failure.latestVersion}).`;
		}
	}
}

function listVersions(versions: RegistryVersions, latestVersion: string): RegistryListedVersion[] {
	return orderVersions(versions, latestVersion).flatMap((version) => {
		const entry = versions[version];
		return entry === undefined ? [] : [{ version, path: entry.path, sha256: entry.sha256, isLatest: version === latestVersion }];
	});
}

/**
 * List every release of a manifest item in a stable order for display.
 *
 * An artifact that has editions gives one group for each edition: the current
 * edition first, then the others by key, highest first. An artifact that has
 * none gives one group whose `edition` is `null`. In each group the latest
 * version is first, then the others from the highest SemVer precedence down.
 *
 * The order is for display only. The default release is always the one
 * `resolveRegistryRelease` returns for an empty request.
 */
export function listRegistryReleases(item: RegistryItemSummary): RegistryReleaseGroup[] {
	if (item.editions === undefined) {
		return [{
			edition: null,
			isCurrent: true,
			latestVersion: item.latestVersion,
			versions: listVersions(item.versions, item.latestVersion),
		}];
	}
	const editions = item.editions;
	return orderKeys(Object.keys(editions), item.currentEdition, compareKeys).flatMap((key) => {
		const entry = editions[key];
		if (entry === undefined) return [];
		return [{
			edition: releaseEdition(key, entry),
			isCurrent: key === item.currentEdition,
			latestVersion: entry.latestVersion,
			versions: listVersions(entry.versions, entry.latestVersion),
		}];
	});
}
