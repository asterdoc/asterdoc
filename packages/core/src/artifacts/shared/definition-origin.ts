import type { SchemaVersion } from '@asterdoc/schemas'
import { upgradeArtifact, type SchemaReadOptions } from '@/migration/upgrade'
import { deepClone } from '@/utils/clone'

/**
 * Where an upgraded definition came from: the definition as stored, at the
 * schema version it declares, and that version. A runtime serializes the
 * stored definition, so a restore upgrades it again and keeps `migratedFrom`.
 */
export interface DefinitionOrigin<T> {
	readonly stored: T
	readonly migratedFrom: SchemaVersion
}

/** The origin of a definition read from `input`, when reading it upgraded it. */
export function originOf<T>(input: unknown, migratedFrom: SchemaVersion | undefined): DefinitionOrigin<T> | undefined {
	return migratedFrom ? { stored: deepClone(input) as T, migratedFrom } : undefined
}

/**
 * Read a stored definition for a runtime restore: the definition upgraded to
 * the current schema version, and its origin when it was upgraded.
 */
export function restoreDefinition<T>(
	stored: T,
	options: SchemaReadOptions | undefined,
): { definition: T; origin: DefinitionOrigin<T> | undefined } {
	const { artifact, migratedFrom } = upgradeArtifact(stored, { strictSchema: options?.strictSchema })
	return { definition: deepClone(artifact), origin: originOf<T>(stored, migratedFrom) }
}
