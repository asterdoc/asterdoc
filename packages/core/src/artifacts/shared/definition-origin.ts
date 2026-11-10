import { ASTERDOC_SCHEMA_URL, type SchemaVersion } from '@asterdoc/schemas'
import { upgradeArtifact, type SchemaReadOptions } from '@/migration/upgrade'
import { canonicalJson } from '@/integrity/canonical-json'
import { deepClone } from '@/utils/clone'

/**
 * Where a definition read from a file came from: the definition as stored,
 * at the schema version it declares, that version when reading upgraded it,
 * and the canonical JSON of the definition read from it. A definition stays
 * of this origin only while it still equals what was read: an edit makes it
 * a definition made in memory.
 */
export interface DefinitionOrigin<T> {
	readonly stored: T
	readonly migratedFrom: SchemaVersion | undefined
	readonly read: string
}

/**
 * The artifact as it is written to a file: the definition with the current
 * dated `$schema` first, or with none.
 */
export function serializableArtifact<T extends object>(data: T, includeSchema = true): T {
	const definition = { ...data } as T & { $schema?: unknown }
	delete definition.$schema
	return includeSchema ? ({ $schema: ASTERDOC_SCHEMA_URL, ...definition } as T) : definition
}

function declaresSchema(input: unknown): boolean {
	return typeof input === 'object' && input !== null && typeof (input as { $schema?: unknown }).$schema === 'string'
}

/**
 * The origin of `definition`, read from `input`, when `input` declares
 * `$schema` or reading upgraded it (an inline bundle part may declare an
 * earlier one). Any other input was made in memory and has no origin.
 */
export function originOf<T extends object>(
	input: unknown,
	definition: T,
	migratedFrom: SchemaVersion | undefined,
): DefinitionOrigin<T> | undefined {
	if (!declaresSchema(input) && migratedFrom === undefined) return undefined
	return { stored: deepClone(input) as T, migratedFrom, read: canonicalJson(definition) }
}

/**
 * A definition was changed after it was read and holds a value with no JSON
 * form, so it cannot be compared with what was read, hashed or cloned.
 */
export class DefinitionNotJsonError extends Error {
	constructor(cause: TypeError) {
		super(
			`The definition was changed after it was read and no longer has a JSON form: ${cause.message}. ` +
				'Write only strings, finite numbers, booleans, null, arrays and plain objects into a definition.',
			{ cause },
		)
		this.name = 'DefinitionNotJsonError'
	}
}

function canonicalDefinition(definition: unknown): string {
	try {
		return canonicalJson(definition)
	} catch (error) {
		if (error instanceof TypeError) throw new DefinitionNotJsonError(error)
		throw error
	}
}

/**
 * The origin, while `definition` still equals the definition read from it.
 *
 * @throws {DefinitionNotJsonError} when a read definition was changed to hold
 * a value with no JSON form.
 */
export function originFor<T>(origin: DefinitionOrigin<T> | undefined, definition: T): DefinitionOrigin<T> | undefined {
	return origin && canonicalDefinition(definition) === origin.read ? origin : undefined
}

/**
 * The schema version the definition was upgraded from, while it still equals
 * the definition read; `undefined` once it was changed.
 */
export function migratedFromOf<T>(origin: DefinitionOrigin<T> | undefined, definition: T): SchemaVersion | undefined {
	if (!origin?.migratedFrom) return undefined
	try {
		return originFor(origin, definition)?.migratedFrom
	} catch (error) {
		if (error instanceof DefinitionNotJsonError) return undefined
		throw error
	}
}

/**
 * The definition as stored: the file it was read from, or, for a definition
 * made in memory, what `toJSON()` writes for it. The caller must not change it.
 */
export function storedDefinition<T extends object>(origin: DefinitionOrigin<T> | undefined, definition: T): T {
	return origin ? origin.stored : serializableArtifact(definition)
}

/**
 * Read a stored definition for a runtime restore: the definition upgraded to
 * the current schema version, and its origin.
 */
export function restoreDefinition<T extends object>(
	stored: T,
	options: SchemaReadOptions | undefined,
): { definition: T; origin: DefinitionOrigin<T> | undefined } {
	const { artifact, migratedFrom } = upgradeArtifact(stored, { strictSchema: options?.strictSchema })
	const definition = deepClone(artifact)
	return { definition, origin: originOf(stored, definition, migratedFrom) }
}
