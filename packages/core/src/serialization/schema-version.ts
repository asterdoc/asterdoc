import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, readSchemaAddress } from '@asterdoc/schemas'
import { LoadError } from './load-error'

/**
 * Why an artifact's schema version cannot be loaded.
 *
 * - `missing-version`: an artifact file has no `$schema`.
 * - `outdated-version`: `$schema` names an earlier published version where
 *   only the current one is accepted: `upgradeArtifact` and every entry point
 *   with `strictSchema: true`.
 * - `newer-version`: `$schema` names a version later than any this SDK knows.
 * - `unknown-version`: `$schema` names an unpublished version earlier than the
 *   current one, names no version at all (the undated `schema.json`), or is
 *   not an Asterdoc address.
 * - `not-upgradable`: `$schema` names an earlier version, and the artifact
 *   cannot be upgraded to the current one without loss.
 * - `no-migration-path`: this SDK has no migration step from a version the
 *   artifact declares to the next one.
 */
export type SchemaVersionErrorCode =
	| 'missing-version'
	| 'outdated-version'
	| 'newer-version'
	| 'unknown-version'
	| 'not-upgradable'
	| 'no-migration-path'

/**
 * An artifact's schema version cannot be read or upgraded.
 *
 * The message names what was found and the current version, and what to do:
 * update `@asterdoc/core` for a newer version, or run `asterdoc migrate` on
 * the file.
 */
export class SchemaVersionError extends LoadError {
	readonly current = SCHEMA_VERSION

	constructor(
		readonly code: SchemaVersionErrorCode,
		/** The `$schema` value found, when there was one. */
		readonly found: unknown,
		message: string,
		/** Where the offending `$schema` sits: `['$schema']` on the root, deeper for an inline bundle part. */
		readonly path: readonly (string | number)[] = ['$schema'],
	) {
		super(message)
		this.name = 'SchemaVersionError'
	}
}

const CURRENT = `the current schema version is ${SCHEMA_VERSION} (${ASTERDOC_SCHEMA_URL})`

type ArtifactShape = { $schema?: unknown; kind?: unknown; contents?: unknown }

/**
 * The schema version problem of an artifact, or `undefined` when it follows
 * the current version.
 *
 * With `required`, the artifact must carry `$schema`: this is the rule for
 * artifact files, from JSON or YAML. Without it, an artifact with no
 * `$schema` is accepted as one built in memory with the SDK, which is always
 * the current version, but a `$schema` it does carry must still be current.
 *
 * A bundle's inline parts are held to the same rule. They may leave out
 * `$schema`, as `migrate` does not add one to them, but one they declare must
 * be current.
 */
export function findSchemaVersionError(
	artifact: unknown,
	options: { required: boolean },
): SchemaVersionError | undefined {
	return findSchemaVersionErrors(artifact, options)[0]
}

/**
 * Every schema version problem of an artifact and its inline bundle parts, the
 * root first. The rules are those of {@link findSchemaVersionError}.
 */
export function findSchemaVersionErrors(artifact: unknown, options: { required: boolean }): SchemaVersionError[] {
	const errors: SchemaVersionError[] = []
	checkArtifact(artifact, options.required, [], undefined, errors)
	return errors
}

/**
 * Throw a {@link SchemaVersionError} unless an artifact, and every inline part
 * of a bundle, follows the current schema version. The rules are those of
 * {@link findSchemaVersionError}.
 */
export function assertCurrentSchemaVersion(artifact: unknown, options: { required: boolean }): void {
	const error = findSchemaVersionError(artifact, options)
	if (error) throw error
}

function checkArtifact(
	artifact: unknown,
	required: boolean,
	at: readonly (string | number)[],
	inlineKey: string | undefined,
	errors: SchemaVersionError[],
): void {
	if (typeof artifact !== 'object' || artifact === null) return
	const { $schema: address, kind, contents } = artifact as ArtifactShape
	const own = checkAddress(address, required, [...at, '$schema'], inlineKey)
	if (own) errors.push(own)
	if (kind !== 'bundle' || !Array.isArray(contents)) return
	for (const [index, item] of contents.entries()) {
		if (typeof item !== 'object' || item === null) continue
		const { type, key, artifact: part } = item as { type?: unknown; key?: unknown; artifact?: unknown }
		if (type !== 'inline') continue
		const partKey = typeof key === 'string' ? key : String(index)
		checkArtifact(part, false, [...at, 'contents', index, 'artifact'], partKey, errors)
	}
}

function checkAddress(
	address: unknown,
	required: boolean,
	path: readonly (string | number)[],
	inlineKey: string | undefined,
): SchemaVersionError | undefined {
	const subject = inlineKey === undefined ? 'The artifact' : `The inline artifact "${inlineKey}"`
	const where = inlineKey === undefined ? '' : `${subject}: `
	if (address === undefined) {
		if (!required) return undefined
		return new SchemaVersionError(
			'missing-version',
			undefined,
			`${subject} has no $schema; ${CURRENT}. Run asterdoc migrate <file> --from <version> to add it.`,
			path,
		)
	}
	const read = typeof address === 'string' ? readSchemaAddress(address) : ({ kind: 'foreign' } as const)
	switch (read.kind) {
		case 'known': {
			const version: string = read.version
			if (version === SCHEMA_VERSION) return undefined
			return new SchemaVersionError(
				'outdated-version',
				address,
				`${subject} was written for schema version ${version}; ${CURRENT}. Run asterdoc migrate <file> to upgrade it.`,
				path,
			)
		}
		case 'undated':
			return new SchemaVersionError(
				'unknown-version',
				address,
				`${where}$schema ${String(address)} names no schema version; ${CURRENT}. Run asterdoc migrate <file> --from <version> to name it.`,
				path,
			)
		case 'unknown-version':
			if (read.version > SCHEMA_VERSION) {
				return new SchemaVersionError(
					'newer-version',
					address,
					`${where}$schema names schema version ${read.version}, newer than this SDK knows; update @asterdoc/core. This SDK reads schema versions up to ${SCHEMA_VERSION}.`,
					path,
				)
			}
			return new SchemaVersionError(
				'unknown-version',
				address,
				`${where}$schema names schema version ${read.version}, which does not exist; ${CURRENT}. Run asterdoc migrate <file> --from <version> once you know its version.`,
				path,
			)
		case 'foreign':
			return new SchemaVersionError(
				'unknown-version',
				address,
				`${where}$schema ${JSON.stringify(address)} is not an Asterdoc schema address; ${CURRENT}. Run asterdoc migrate <file> --from <version> once you know its version.`,
				path,
			)
	}
}
