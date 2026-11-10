import { SCHEMA_VERSION, readSchemaAddress, type SchemaVersion } from '@asterdoc/schemas'
import { SchemaVersionError, findSchemaVersionErrors } from '@/serialization/schema-version'
import { SchemaMigrationError } from './errors'
import { upgradeArtifactObject } from './convert'
import type { ArtifactObject } from './steps'

/** How an entry point treats an artifact written for an earlier schema version. */
export interface SchemaReadOptions {
	/**
	 * Accept only the current schema version: an artifact that declares an
	 * earlier one is refused with a `SchemaVersionError` of code
	 * `outdated-version` instead of being upgraded in memory.
	 */
	strictSchema?: boolean
}

/** Options for {@link upgradeArtifact}. */
export interface UpgradeArtifactOptions extends SchemaReadOptions {
	/** The rule for artifact files: `$schema` must be present. */
	required?: boolean
}

/** An artifact at the current schema version, and the version it was written for when it was upgraded. */
export interface UpgradedArtifact<T = unknown> {
	readonly artifact: T
	/**
	 * The earliest schema version the stored definition declared, on its root
	 * or an inline bundle part, when it was upgraded in memory. `undefined`
	 * when it was already current.
	 */
	readonly migratedFrom: SchemaVersion | undefined
}

function declaredVersion(error: SchemaVersionError): SchemaVersion | undefined {
	if (typeof error.found !== 'string') return undefined
	const read = readSchemaAddress(error.found)
	return read.kind === 'known' ? read.version : undefined
}

/**
 * Bring a parsed artifact to the current schema version, in memory.
 *
 * An artifact that declares an earlier published version, on its root or on an
 * inline bundle part, is upgraded through the migration steps; the input is
 * never changed and nothing is written back. An artifact that is current, or
 * that has no `$schema` and is not `required` to, is returned as it is.
 *
 * Throws `SchemaVersionError`:
 * - `outdated-version` for an earlier version with `strictSchema`;
 * - `newer-version` for a version later than any this SDK knows;
 * - `not-upgradable` when a step cannot convert a value without loss;
 * - `no-migration-path` when this SDK has no step from a version to the next;
 * - `missing-version` or `unknown-version` as {@link findSchemaVersionError} reports them.
 *
 * The result is not validated: validate it as any current artifact.
 */
export function upgradeArtifact<T = unknown>(input: T, options: UpgradeArtifactOptions = {}): UpgradedArtifact<T> {
	const errors = findSchemaVersionErrors(input, { required: options.required ?? false })
	if (errors.length === 0) return { artifact: input, migratedFrom: undefined }
	const refusal = errors.find((error) => error.code !== 'outdated-version') ?? (options.strictSchema ? errors[0] : undefined)
	if (refusal) throw refusal

	const migratedFrom = errors.flatMap((error) => declaredVersion(error) ?? []).sort()[0]
	try {
		return { artifact: upgradeArtifactObject(input as ArtifactObject) as T, migratedFrom }
	} catch (error) {
		if (!(error instanceof SchemaMigrationError)) throw error
		const first = errors[0] as SchemaVersionError
		if (error.code === 'unconvertible-value') {
			throw new SchemaVersionError(
				'not-upgradable',
				first.found,
				`The artifact was written for schema version ${String(migratedFrom)} and cannot be upgraded to ${SCHEMA_VERSION} without loss: ${error.message}`,
				first.path,
			)
		}
		if (error.code === 'no-migration-path') {
			throw new SchemaVersionError(
				'no-migration-path',
				first.found,
				`This SDK cannot upgrade schema version ${String(migratedFrom)} to ${SCHEMA_VERSION}: ${error.message} Update @asterdoc/core.`,
				first.path,
			)
		}
		throw new SchemaVersionError('unknown-version', first.found, error.message, first.path)
	}
}
