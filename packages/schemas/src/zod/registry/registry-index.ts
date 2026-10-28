/**
 * Registry Manifest Schema
 *
 * Defines the schema for registry.json: the one file that lists every
 * artifact a file registry serves, with every edition and version of each.
 *
 * A release is one version of one edition, or one version of an artifact
 * that has no editions. An item never states a fact two times: the item (or
 * the edition) names the default by its key, and the keyed lists hold the
 * facts. A reader never compares dates or version numbers to find a default;
 * it reads `currentEdition` and `latestVersion`, which the publisher states.
 */

import { z } from 'zod';
import { editionFactsShape } from '../artifacts/shared/edition';
import { COORDINATE_SEGMENT_PATTERN } from '../primitives/artifact-coordinate';
import { EditionKeySchema } from '../primitives/artifact-selectors';
import { REGISTRY_ITEM_NAME_MAX_LENGTH } from '../primitives/registry-reference';
import { REGISTRY_VERSION_PATTERN } from '../primitives/version';

/**
 * The name of an artifact in a manifest: one coordinate segment, so lowercase
 * letters and digits with single hyphens between them. It is the name segment
 * of a reference such as `@acme/w-9`.
 */
export const RegistryItemNameSchema = z.string()
	.min(1)
	.max(REGISTRY_ITEM_NAME_MAX_LENGTH)
	.regex(
		COORDINATE_SEGMENT_PATTERN,
		'Expected an artifact name: lowercase letters and digits with single hyphens, such as w-9',
	);

/**
 * A version as the key of a `versions` object: a SemVer 2.0.0 version with no
 * build metadata. The pattern can never match the selectors `latest` and
 * `current`.
 */
export const RegistryVersionKeySchema = z.string()
	.max(200)
	.regex(
		REGISTRY_VERSION_PATTERN,
		'Expected a SemVer version with no build metadata, such as 1.2.0 or 1.3.0-beta.1',
	);

/** The longest artifact file path a manifest lists. */
export const REGISTRY_ARTIFACT_PATH_MAX_LENGTH = 500;

/**
 * Artifact file path pattern
 *
 * A path relative to the registry's base address. Segments are letters,
 * digits, dots, hyphens and underscores, separated by single forward slashes.
 * No leading slash, no `.` or `..` segment, no backslash, and nothing a URL
 * would read as an escape, a query or a fragment. The file name ends in
 * `.json`, `.yaml` or `.yml`.
 */
export const REGISTRY_ARTIFACT_PATH_PATTERN =
	/^(?:(?!\.{1,2}\/)[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:json|yaml|yml)$/;

/**
 * One version of an artifact: where its file is, and the checksum of that file.
 */
export const RegistryVersionEntrySchema = z.strictObject({
	path: z.string()
		.max(REGISTRY_ARTIFACT_PATH_MAX_LENGTH)
		.regex(
			REGISTRY_ARTIFACT_PATH_PATTERN,
			'Expected a path relative to the registry base address, such as w-9/2024-03/1.0.0/w-9.json: forward slashes, no leading slash, no . or .. segment, ending in .json, .yaml or .yml',
		)
		.describe('Path to the artifact file, relative to the registry base address (the address of the folder that holds registry.json), such as w-9/2024-03/1.0.0/w-9.json. Forward slashes only, no leading slash, no . or .. segment, ending in .json, .yaml or .yml. No two versions in one manifest have the same path.'),
	sha256: z.string()
		.regex(/^[a-f0-9]{64}$/, 'Expected a SHA-256 digest as 64 lowercase hex digits')
		.describe('SHA-256 digest of the bytes of the artifact file at path, as 64 lowercase hex digits. A reader refuses a file whose digest is different.'),
}).meta({
	title: 'RegistryVersionEntry',
	description: 'One version of an artifact in a registry: the path of its file and the checksum of that file. The version itself is the key of this entry.',
});

/** The rule an empty `versions` object breaks. */
export const REGISTRY_VERSIONS_EMPTY_RULE = 'Expected at least one version';

/** The rule an empty `editions` object breaks. */
export const REGISTRY_EDITIONS_EMPTY_RULE = 'Expected at least one edition';

const isNotEmpty = (value: Record<string, unknown>) => Object.keys(value).length > 0;

const isOwnKey = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const listKeys = (value: Record<string, unknown>) => Object.keys(value).join(', ');

/**
 * Whether `key` names an entry of `entries`. An empty object passes: its own
 * rule reports it, and a second message about the key would only add noise.
 */
const namesEntry = (entries: Record<string, unknown>, key: string) => !isNotEmpty(entries) || isOwnKey(entries, key);

/** The message for a key of a keyed object that breaks the key rule: the rule's own message, and the key. */
const keyRuleError = (issue: { code?: string; input?: unknown; issues?: Array<{ message: string }> }) =>
	issue.code === 'invalid_key' ? `${issue.issues?.[0]?.message ?? 'Invalid key'}; got "${String(issue.input)}"` : undefined;

/**
 * The versions of one edition, or of an artifact that has no editions, keyed
 * by version.
 */
export const RegistryVersionsSchema = z.record(RegistryVersionKeySchema, RegistryVersionEntrySchema, { error: keyRuleError })
	.refine(isNotEmpty, REGISTRY_VERSIONS_EMPTY_RULE)
	.meta({
		title: 'RegistryVersions',
		description: 'Versions keyed by version. Each key is a SemVer 2.0.0 version with no build metadata, such as 1.2.0 or 1.3.0-beta.1, and never latest or current. At least one version. The order of the keys has no meaning.',
		minProperties: 1,
	});

const LATEST_VERSION_DESCRIPTION =
	"The version to use when a request names none. It is the publisher's statement and must be a key of versions. It is normally the highest stable version; a pre-release is the default only when the publisher points at it. A reader uses this value and never compares version numbers.";

/**
 * One edition of an artifact in a manifest: the artifact's own edition facts
 * without `key` (the key is the object key), and the edition's versions.
 */
export const RegistryEditionEntrySchema = z.strictObject({
	...editionFactsShape,
	latestVersion: RegistryVersionKeySchema.describe(LATEST_VERSION_DESCRIPTION),
	versions: RegistryVersionsSchema,
}).superRefine((edition, ctx) => {
	if (!namesEntry(edition.versions, edition.latestVersion)) {
		ctx.addIssue({
			code: 'custom',
			path: ['latestVersion'],
			message: `latestVersion "${edition.latestVersion}" is not a key of versions (${listKeys(edition.versions)})`,
		});
	}
}).meta({
	title: 'RegistryEditionEntry',
	description: "One edition of an issued artifact, as printed by its issuer, and the publisher's versions of it. The edition key is the key of this entry.",
});

/** The editions of an artifact, keyed by edition key. */
export const RegistryEditionsSchema = z.record(EditionKeySchema, RegistryEditionEntrySchema, { error: keyRuleError })
	.refine(isNotEmpty, REGISTRY_EDITIONS_EMPTY_RULE)
	.meta({
		title: 'RegistryEditions',
		description: 'Editions keyed by edition key. Each key is lowercase letters and digits with single hyphens, such as 2024-03 or 3b, and never current, latest, editions, tags or diff. At least one edition. The order of the keys has no meaning.',
		minProperties: 1,
	});

/** The rule an item with neither editions nor versions breaks. */
export const REGISTRY_ITEM_RELEASES_RULE =
	'Expected either currentEdition with editions (an artifact that has editions), or latestVersion with versions (an artifact that has none)';

/** The rule an item with editions breaks when it also states versions of its own. */
export const REGISTRY_ITEM_EDITIONS_ONLY_RULE =
	'An artifact that has editions states latestVersion and versions inside each edition, never on the item';

/**
 * The editions-or-versions rule, stated to JSON Schema as well as at runtime:
 * a refinement alone would vanish from the published schema.
 */
const editionsOrVersionsJsonSchema = [
	{
		required: ['currentEdition', 'editions'],
		not: { anyOf: [{ required: ['latestVersion'] }, { required: ['versions'] }] },
	},
	{
		required: ['latestVersion', 'versions'],
		not: { anyOf: [{ required: ['currentEdition'] }, { required: ['editions'] }] },
	},
];

const RegistryItemObjectSchema = z.strictObject({
	name: RegistryItemNameSchema
		.describe('Artifact name, unique within the registry. Lowercase letters and digits with single hyphens. It is the name segment of a reference such as @acme/w-9, and every edition and version of the artifact shares it.'),
	kind: z.union([
		z.literal('form'),
		z.literal('document'),
		z.literal('checklist'),
		z.literal('bundle'),
	]).describe('Artifact kind'),
	title: z.string()
		.min(1)
		.max(200)
		.describe('Human-readable title')
		.optional(),
	description: z.string()
		.max(2000)
		.describe('Brief description of the artifact')
		.optional(),
	currentEdition: EditionKeySchema
		.describe("The edition to use when a request names none. It is the publisher's statement and must be a key of editions. It is not the newest edition by date: a publisher may list an edition that takes effect in the future. A reader uses this value and never compares dates. Present only with editions.")
		.optional(),
	editions: RegistryEditionsSchema
		.describe("The issuer's editions of this artifact, keyed by edition key. Present only on an artifact that is issued in editions; then latestVersion and versions are inside each edition and absent on the item.")
		.optional(),
	latestVersion: RegistryVersionKeySchema
		.describe(`${LATEST_VERSION_DESCRIPTION} Present only with versions, on an artifact that has no editions.`)
		.optional(),
	versions: RegistryVersionsSchema
		.describe('The versions of an artifact that has no editions, keyed by version. Present only when editions is absent.')
		.optional(),
	layers: z.array(z.string().describe('Layer key'))
		.describe('Available layer keys')
		.optional(),
	tags: z.array(
		z.string().min(1).max(50).describe('Tag for categorization'),
	).describe('Tags for search and filtering')
		.optional(),
}).superRefine((item, ctx) => {
	const hasEditions = item.currentEdition !== undefined || item.editions !== undefined;
	const hasVersions = item.latestVersion !== undefined || item.versions !== undefined;

	if (!hasEditions && !hasVersions) {
		ctx.addIssue({ code: 'custom', path: [], message: REGISTRY_ITEM_RELEASES_RULE });
		return;
	}

	if (hasEditions) {
		for (const key of ['latestVersion', 'versions'] as const) {
			if (item[key] !== undefined) {
				ctx.addIssue({ code: 'custom', path: [key], message: REGISTRY_ITEM_EDITIONS_ONLY_RULE });
			}
		}
		if (item.currentEdition === undefined) {
			ctx.addIssue({ code: 'custom', path: ['currentEdition'], message: 'Required with editions: name the edition to use by default' });
		} else if (item.editions === undefined) {
			ctx.addIssue({ code: 'custom', path: ['editions'], message: 'Required with currentEdition: list the editions' });
		} else if (!namesEntry(item.editions, item.currentEdition)) {
			ctx.addIssue({
				code: 'custom',
				path: ['currentEdition'],
				message: `currentEdition "${item.currentEdition}" is not a key of editions (${listKeys(item.editions)})`,
			});
		}
		return;
	}

	if (item.latestVersion === undefined) {
		ctx.addIssue({ code: 'custom', path: ['latestVersion'], message: 'Required with versions: name the version to use by default' });
	} else if (item.versions === undefined) {
		ctx.addIssue({ code: 'custom', path: ['versions'], message: 'Required with latestVersion: list the versions' });
	} else if (!namesEntry(item.versions, item.latestVersion)) {
		ctx.addIssue({
			code: 'custom',
			path: ['latestVersion'],
			message: `latestVersion "${item.latestVersion}" is not a key of versions (${listKeys(item.versions)})`,
		});
	}
}).meta({
	title: 'RegistryItemSummary',
	description: 'One artifact in the registry, with every release of it. An artifact that is issued in editions has currentEdition and editions; an artifact that is not has latestVersion and versions. Never both, and never neither.',
	oneOf: editionsOrVersionsJsonSchema,
});

type RegistryItemFields = z.infer<typeof RegistryItemObjectSchema>;
type RegistryItemCommon = Omit<RegistryItemFields, 'currentEdition' | 'editions' | 'latestVersion' | 'versions'>;

/** A manifest item for an artifact that is issued in editions. */
export type RegistryItemWithEditions = RegistryItemCommon & {
	currentEdition: string;
	editions: RegistryEditions;
	latestVersion?: undefined;
	versions?: undefined;
};

/** A manifest item for an artifact that has no editions. */
export type RegistryItemWithVersions = RegistryItemCommon & {
	latestVersion: string;
	versions: RegistryVersions;
	currentEdition?: undefined;
	editions?: undefined;
};

/** One artifact in a manifest: with editions, or with versions of its own. */
export type RegistryItemSummary = RegistryItemWithEditions | RegistryItemWithVersions;

/**
 * One artifact in a manifest. The refinement admits exactly the two forms of
 * `RegistryItemSummary`, so the schema is typed as that union and a reader
 * narrows on `item.editions`.
 */
export const RegistryItemSummarySchema = RegistryItemObjectSchema as z.ZodType<RegistryItemSummary, RegistryItemFields>;

/**
 * Every version entry of an item, with the path to it inside the item. It
 * reads the item's fields, not one of its two forms: the manifest's own rules
 * also run on an item that broke the editions-or-versions rule.
 */
function listVersionEntries(item: RegistryItemFields): Array<{ path: PropertyKey[]; entry: RegistryVersionEntry }> {
	const inEditions = Object.entries(item.editions ?? {}).flatMap(([editionKey, edition]) =>
		Object.entries(edition.versions).map(([version, entry]) => ({
			path: ['editions', editionKey, 'versions', version],
			entry,
		})),
	);
	const onItem = Object.entries(item.versions ?? {}).map(([version, entry]) => ({ path: ['versions', version], entry }));
	return [...inEditions, ...onItem];
}

const formatLocation = (path: PropertyKey[]) =>
	path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '');

/**
 * Registry manifest schema for registry.json
 */
export const RegistryIndexSchema = z.object({
	$schema: z.url()
		.describe('JSON Schema URI for validation')
		.optional(),
	name: z.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
		.describe('Registry name/identifier (lowercase slug, used for data attributes and metadata)'),
	homepage: z.url()
		.describe('Homepage URL for the registry')
		.optional(),
	description: z.string()
		.max(2000)
		.describe('Description of the registry')
		.optional(),
	enableTelemetry: z.boolean()
		.default(true)
		.describe('Enable anonymous usage telemetry for artifact installs. Defaults to true.')
		.optional(),
	enableDirectory: z.boolean()
		.default(true)
		.describe('Allow this registry to appear in the Asterdoc Hub directory. Defaults to true.')
		.optional(),
	items: z.array(RegistryItemSummarySchema)
		.describe('Every artifact in the registry, one item for each artifact name. No two items have the same name, and no two versions in the manifest have the same path.'),
}).strict().superRefine((manifest, ctx) => {
	const names = new Map<string, number>();
	const paths = new Map<string, string>();

	manifest.items.forEach((item, index) => {
		const firstIndex = names.get(item.name);
		if (firstIndex === undefined) {
			names.set(item.name, index);
		} else {
			ctx.addIssue({
				code: 'custom',
				path: ['items', index, 'name'],
				message: `Duplicate item name "${item.name}": items[${firstIndex}] already has it`,
			});
		}

		for (const { path, entry } of listVersionEntries(item)) {
			const location = ['items', index, ...path];
			const firstLocation = paths.get(entry.path);
			if (firstLocation === undefined) {
				paths.set(entry.path, formatLocation(location));
			} else {
				ctx.addIssue({
					code: 'custom',
					path: [...location, 'path'],
					message: `Duplicate path "${entry.path}": ${firstLocation} already has it`,
				});
			}
		}
	});
}).meta({
	title: 'Asterdoc Registry Manifest',
	description: 'Schema for registry.json, the manifest of a file registry. It lists every artifact the registry serves, with every edition and version of each. Every path is relative to the registry base address: the address of the folder that holds registry.json.',
});

/**
 * TypeScript types
 */
export type RegistryVersionEntry = z.infer<typeof RegistryVersionEntrySchema>;
export type RegistryVersions = z.infer<typeof RegistryVersionsSchema>;
export type RegistryEditionEntry = z.infer<typeof RegistryEditionEntrySchema>;
export type RegistryEditions = z.infer<typeof RegistryEditionsSchema>;
export type RegistryIndex = z.infer<typeof RegistryIndexSchema>;
