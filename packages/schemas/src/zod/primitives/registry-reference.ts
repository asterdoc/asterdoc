import { CURRENT_EDITION, EDITION_SOURCE, LATEST_VERSION, SEGMENT_SOURCE, VERSION_SOURCE } from './artifact-coordinate';
import { REGISTRY_NAMESPACE_PATTERN } from './name';

/**
 * File registry references
 *
 * A reference addresses an artifact in a file registry: the registry's
 * namespace, the artifact's name, then an optional edition and an optional
 * version. The leading `@` is required, because it is what tells a reference
 * from a path.
 *
 * - `@acme/w-9` is the current edition, latest version.
 * - `@acme/w-9/2024-03` is the latest version of edition 2024-03.
 * - `@acme/w-9@1.0.0` is version 1.0.0 of the current edition, or of an
 *   artifact that has no editions.
 * - `@acme/w-9/2024-03@1.0.0` pins one edition and one version.
 *
 * `current` names the current edition and `latest` the latest version, so
 * `@acme/w-9/current@latest` is the same as `@acme/w-9`.
 *
 * The edition and version tail is the tail of the platform coordinate
 * grammar (`artifact-coordinate.ts`); only the head differs. A string such as
 * `@acme/w-9/2024-03` is also a platform coordinate (org, repo, name), so a
 * caller chooses the grammar by the namespace before it parses.
 */

const NAMESPACE_SOURCE = REGISTRY_NAMESPACE_PATTERN.source.slice(1, -1);

/** The longest artifact name a registry manifest lists. */
export const REGISTRY_ITEM_NAME_MAX_LENGTH = 128;

/**
 * The name position of a reference: one coordinate segment of at most
 * `REGISTRY_ITEM_NAME_MAX_LENGTH` characters, the name rule of a manifest
 * item. The lookahead ends at the `/` of an edition, the `@` of a version, or
 * the end of the reference.
 */
const NAME_SOURCE = `(?=[a-z0-9-]{1,${REGISTRY_ITEM_NAME_MAX_LENGTH}}(?:[/@]|$))${SEGMENT_SOURCE}`;

/**
 * A full file registry reference: `@ns/name`, an optional `/edition` (a key
 * or `current`), and an optional `@version` (a SemVer version or `latest`).
 * It accepts exactly the strings `parseRegistryReference` parses, and uses no
 * named groups, so JSON Schema validators in other languages accept it.
 */
export const REGISTRY_REFERENCE_PATTERN = new RegExp(
	`^${NAMESPACE_SOURCE}/${NAME_SOURCE}(?:/(?:${EDITION_SOURCE}))?(?:@(?:${VERSION_SOURCE}))?$`,
);

/** The reference pattern with named parts, for parsing only. */
const REFERENCE_PARTS = new RegExp(
	`^(?<namespace>${NAMESPACE_SOURCE})/(?<name>${NAME_SOURCE})(?:/(?<edition>${EDITION_SOURCE}))?(?:@(?<version>${VERSION_SOURCE}))?$`,
);

/** The parts of a file registry reference. */
export interface RegistryReference {
	/** The registry namespace with its leading `@`, such as `@acme`. */
	readonly namespace: string;
	/** The artifact name: the `name` of an item in the registry manifest. */
	readonly name: string;
	/** An edition key. Omitted: the artifact's current edition. */
	readonly edition?: string;
	/** A SemVer version. Omitted: the latest version. */
	readonly version?: string;
}

/**
 * Parse a file registry reference into its parts, or `undefined` when it is
 * not one. The selectors `current` and `latest` parse to an omitted edition
 * and version. A reserved word other than `current` in the edition position
 * is not a reference.
 */
export function parseRegistryReference(value: string): RegistryReference | undefined {
	const match = REFERENCE_PARTS.exec(value);
	if (!match) return undefined;
	const { namespace, name, edition, version } = match.groups as {
		namespace: string;
		name: string;
		edition?: string;
		version?: string;
	};
	return {
		namespace,
		name,
		...(edition !== undefined && edition !== CURRENT_EDITION && { edition }),
		...(version !== undefined && version !== LATEST_VERSION && { version }),
	};
}

/**
 * Format reference parts as `@ns/name[/edition][@version]`, the inverse of
 * `parseRegistryReference`. Parts that are omitted stay omitted: the
 * selectors `current` and `latest` are never written.
 */
export function formatRegistryReference(reference: RegistryReference): string {
	const edition = reference.edition === undefined ? '' : `/${reference.edition}`;
	const version = reference.version === undefined ? '' : `@${reference.version}`;
	return `${reference.namespace}/${reference.name}${edition}${version}`;
}
