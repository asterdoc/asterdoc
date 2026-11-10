import {
	ASTERDOC_SCHEMA_URL,
	SCHEMA_VERSION,
	SCHEMA_VERSIONS,
	readSchemaAddress,
	type SchemaVersion,
} from '@asterdoc/schemas'
import { deepClone } from '@/utils/clone'
import { SchemaMigrationError, UnconvertibleValueError } from './errors'
import { MIGRATION_STEPS, type ArtifactObject, type MigrationStep } from './steps'

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the version an artifact declares, or the one the caller names for it. */
export function sourceVersion(artifact: ArtifactObject, from: SchemaVersion | undefined): { version: SchemaVersion; declared: boolean } {
	const address = artifact.$schema
	if (address === undefined) {
		if (from) return { version: from, declared: false }
		throw new SchemaMigrationError(
			'missing-version',
			`The artifact has no $schema. Name its version with asterdoc migrate --from <version>; the current version is ${SCHEMA_VERSION}.`,
		)
	}
	const read = typeof address === 'string' ? readSchemaAddress(address) : ({ kind: 'foreign' } as const)
	if (read.kind === 'known') {
		const declared: string = read.version
		if (from && from !== declared) {
			throw new SchemaMigrationError(
				'version-conflict',
				`$schema declares ${declared}, but ${from} was named as the source version.`,
			)
		}
		return { version: read.version, declared: true }
	}
	// Any other address names no published version, so the caller must.
	if (from) return { version: from, declared: false }
	switch (read.kind) {
		case 'undated':
			throw new SchemaMigrationError(
				'missing-version',
				`$schema ${String(address)} names no schema version. Name its version with asterdoc migrate --from <version>; the current version is ${SCHEMA_VERSION}.`,
			)
		case 'unknown-version':
			if (read.version > SCHEMA_VERSION) {
				throw new SchemaMigrationError(
					'unknown-version',
					`$schema names schema version ${read.version}, newer than this SDK knows; update @asterdoc/core. This SDK reads schema versions up to ${SCHEMA_VERSION}.`,
				)
			}
			throw new SchemaMigrationError(
				'unknown-version',
				`$schema names schema version ${read.version}, which does not exist. Known versions: ${SCHEMA_VERSIONS.join(', ')}; name the right one with asterdoc migrate --from <version>.`,
			)
		case 'foreign':
			throw new SchemaMigrationError(
				'unknown-version',
				`$schema ${JSON.stringify(address)} is not an Asterdoc schema address. Name its version with asterdoc migrate --from <version>.`,
			)
	}
}

/** The ordered steps from one version to a later one, the current one by default. */
function stepsFrom(
	version: SchemaVersion,
	steps: readonly MigrationStep[],
	to: SchemaVersion = SCHEMA_VERSION,
): MigrationStep[] {
	const chain: MigrationStep[] = []
	for (let index = SCHEMA_VERSIONS.indexOf(version); index < SCHEMA_VERSIONS.indexOf(to); index++) {
		const from = SCHEMA_VERSIONS[index] as SchemaVersion
		const to = SCHEMA_VERSIONS[index + 1] as SchemaVersion
		const step = steps.find((candidate) => candidate.from === from && candidate.to === to)
		if (!step) {
			throw new SchemaMigrationError('no-migration-path', `No migration step leads from schema version ${from} to ${to}.`)
		}
		chain.push(step)
	}
	return chain
}

/** The inline parts of a bundle, one level down. */
function inlineParts(artifact: ArtifactObject): { key: string; item: Record<string, unknown>; part: ArtifactObject }[] {
	const contents = artifact.contents
	if (artifact.kind !== 'bundle' || !Array.isArray(contents)) return []
	return contents.flatMap((item, index) =>
		isObject(item) && item.type === 'inline' && isObject(item.artifact)
			? [{ key: typeof item.key === 'string' ? item.key : String(index), item, part: item.artifact }]
			: [],
	)
}

/**
 * Convert one artifact from its own version to the current one, in place.
 *
 * Each inline part of a bundle converts first, from the version it declares,
 * or from its bundle's version when it declares none, so a part may be on an
 * earlier or a later version than its bundle. The bundle's own steps then run
 * with its parts detached, so no step applies to a part twice.
 */
function convertNode(node: ArtifactObject, version: SchemaVersion, steps: readonly MigrationStep[]): ArtifactObject {
	const parts = inlineParts(node)
	const converted = parts.map(({ key, part }) => convertNode(part, inlinePartVersion(part, key, version), steps))
	for (const { item } of parts) item.artifact = {}
	let artifact = node
	for (const step of stepsFrom(version, steps)) artifact = step.apply(artifact)
	const detached = inlineParts(artifact)
	if (detached.length !== converted.length) {
		throw new SchemaMigrationError(
			'unconvertible-value',
			`A migration step from schema version ${version} changed the inline parts of bundle "${String(artifact.name)}"; each part converts on its own.`,
		)
	}
	detached.forEach(({ item }, index) => {
		item.artifact = converted[index]
	})
	return artifact
}

function inlinePartVersion(part: ArtifactObject, key: string, bundleVersion: SchemaVersion): SchemaVersion {
	const address = part.$schema
	if (address === undefined) return bundleVersion
	const read = typeof address === 'string' ? readSchemaAddress(address) : ({ kind: 'foreign' } as const)
	if (read.kind !== 'known') {
		throw new SchemaMigrationError(
			'unknown-version',
			`The inline artifact "${key}" declares $schema ${JSON.stringify(address)}, which names no published schema version. Set it to a published version, such as the bundle's ${bundleVersion}, or remove it.`,
		)
	}
	return read.version
}

/** Point `$schema` at the current version: first on the root, kept in place on inline parts at any depth. */
function stampCurrentVersion(artifact: ArtifactObject): ArtifactObject {
	stampInlineParts(artifact)
	const { $schema: _previous, ...rest } = artifact
	return { $schema: ASTERDOC_SCHEMA_URL, ...rest }
}

function stampInlineParts(artifact: ArtifactObject): void {
	for (const { part } of inlineParts(artifact)) {
		if (part.$schema !== undefined) part.$schema = ASTERDOC_SCHEMA_URL
		stampInlineParts(part)
	}
}

/**
 * Convert a copy of the artifact from `version`, and each inline part from its
 * own version, to the current one, and stamp the current `$schema`.
 */
export function convert(
	input: ArtifactObject,
	version: SchemaVersion,
	steps: readonly MigrationStep[],
): { chain: MigrationStep[]; artifact: ArtifactObject } {
	const chain = stepsFrom(version, steps)
	let artifact: ArtifactObject
	try {
		artifact = convertNode(deepClone(input), version, steps)
	} catch (error) {
		if (error instanceof UnconvertibleValueError) throw new SchemaMigrationError('unconvertible-value', error.message)
		throw error
	}
	return { chain, artifact: stampCurrentVersion(artifact) }
}

/**
 * Convert an artifact to the current version, in memory. A root without
 * `$schema` is taken as current, so only its inline parts convert, and it
 * stays without one. Unlike {@link migrateArtifact} it leaves validation to
 * the caller, which validates the result as it would any current artifact.
 */
export function upgradeArtifactObject(input: ArtifactObject, steps: readonly MigrationStep[] = MIGRATION_STEPS): ArtifactObject {
	const { version, declared } = sourceVersion(input, input.$schema === undefined ? SCHEMA_VERSION : undefined)
	const { artifact } = convert(input, version, steps)
	if (declared) return artifact
	const { $schema: _stamped, ...undeclared } = artifact
	return undeclared
}
