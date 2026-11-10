/**
 * Artifact Methods - Shared functionality via composition
 *
 * This replaces BaseArtifactInstance inheritance with composition.
 * All artifact instances use withArtifactMethods() to get common functionality.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Artifact, ArtifactEdition, Metadata, ContentRef } from '@asterdoc/types'
import { validate as validateArtifact, validateDefinition } from '@/validation/artifact'
import { toYAML } from '@/serialization/serialization'
import { assertCurrentSchemaVersion } from '@/serialization/schema-version'
import type { SchemaVersion } from '@asterdoc/schemas'
import { originFor, serializableArtifact, storedDefinition, type DefinitionOrigin } from '@/artifacts/shared/definition-origin'
import { contentHashOf } from '@/integrity/seal-integrity'
import type { ValidateOptions, SerializationOptions } from '@/types'
import { deepClone, deepFreeze } from '@/utils/clone'

/**
 * Common artifact methods interface
 */
export interface ArtifactMethods<T extends Artifact> {
	/** Internal data access */
	readonly _data: T

	/** Artifact kind discriminator */
	readonly kind: T['kind']

	/** Artifact name (required) */
	readonly name: string

	/** Artifact version */
	readonly version: string | undefined

	/** Human-readable title */
	readonly title: string | undefined

	/** Description */
	readonly description: string | undefined

	/** The form number as printed by its issuer */
	readonly code: string | undefined

	/** The organization that issues the form */
	readonly issuer: string | undefined

	/** The issuer edition this artifact encodes */
	readonly edition: ArtifactEdition | undefined

	/** Artifact source language */
	readonly language: string | undefined

	/** Custom metadata */
	readonly metadata: Metadata | undefined

	/** Domain or compliance reference content */
	readonly instructions: ContentRef | undefined

	/** LLM/agent prompts for presentation guidance */
	readonly agentInstructions: ContentRef | undefined

	/**
	 * The earliest schema version the definition declared when it was
	 * upgraded in memory on load, on its root or an inline bundle part.
	 * `undefined` when it was already current, or once the definition was
	 * edited after it was read. The stored definition is never rewritten.
	 */
	readonly migratedFrom: SchemaVersion | undefined

	/**
	 * The `sha256:` digest of the RFC 8785 canonical JSON of the definition as
	 * stored: the parsed input before migration, defaults or normalization, at
	 * the schema version it declares. An input reading upgraded (one with no
	 * root `$schema` but an earlier inline part) is stored as it was given.
	 * A definition with no `$schema` that reading did not upgrade, or one
	 * edited after it was read, hashes what `toJSON()` writes for it now.
	 * Template and font bytes are covered through the checksums their layers
	 * declare. Object keys are sorted, so key order (such as the order of
	 * `layers`) is not part of the hash: set `defaultLayer` when it matters.
	 *
	 * @throws {DefinitionNotJsonError} when a definition read from a file was
	 * edited to hold a value with no JSON form.
	 */
	contentHash(): Promise<string>

	/**
	 * Validates the artifact schema definition.
	 * Returns a Standard Schema result with either `value` or `issues`.
	 */
	validate(options?: ValidateOptions): StandardSchemaV1.Result<T>

	/**
	 * Checks if the artifact schema definition is valid.
	 * Returns true if valid, false otherwise.
	 */
	isValid(options?: ValidateOptions): boolean

	/**
	 * Serialize to JSON object.
	 * Includes the current dated `$schema` unless `includeSchema` is false.
	 */
	toJSON(options?: SerializationOptions): T

	/**
	 * Serialize to YAML string.
	 * Includes the current dated `$schema` unless `includeSchema` is false.
	 */
	toYAML(options?: SerializationOptions): string
}

/**
 * Validate the definition at a runtime consumption boundary.
 *
 * Authoring definitions are intentionally mutable, so a caller can edit the
 * object returned by `toJSON({ includeSchema: false })`. Runtime instances
 * must still start from a valid definition and retain the definition that was
 * validated at their creation time.
 */
export function assertValidArtifactDefinition<T extends Artifact>(data: T): void {
	assertCurrentSchemaVersion(data, { required: false })
	const result = validateDefinition<T>(data)
	if ('issues' in result && result.issues) {
		const details = result.issues
			.map((issue) => {
				const path = issue.path?.length ? ` at ${issue.path.join('.')}` : ''
				return `${issue.message}${path}`
			})
			.join('; ')
		throw new Error(`Invalid ${data.kind} definition: ${details || 'validation failed'}`)
	}
}

/**
 * Detach a definition for one runtime artifact instance.
 *
 * This helper only receives artifact data. Runtime behavior such as a layer
 * resolver is carried separately and is never passed through structuredClone.
 */
export function snapshotArtifactDefinition<T extends Artifact>(data: T): T {
	return deepClone(data)
}

/**
 * Freeze the definition a runtime instance runs on, in place. A runtime is
 * immutable: its definition is a snapshot taken at fill or prepare, and an
 * edit goes through the authoring definition and a new runtime.
 */
export function freezeRuntimeDefinition<T extends Artifact>(data: T): T {
	return Object.isFrozen(data) ? data : deepFreeze(data)
}

/**
 * Creates an object with common artifact methods.
 * Use this via composition instead of class inheritance.
 *
 * @param data - The artifact data
 * @returns Object with common artifact properties and methods
 *
 * @example
 * ```typescript
 * function createDocumentInstance(doc: Document) {
 *   return {
 *     ...withArtifactMethods(doc),
 *     // Document-specific methods...
 *     prepare() { ... },
 *   }
 * }
 * ```
 */
export function withArtifactMethods<T extends Artifact>(
	data: T,
	origin?: DefinitionOrigin<T>,
): Omit<ArtifactMethods<T>, 'migratedFrom'> {
	return {
		_data: data,

		// Direct property access
		kind: data.kind,
		name: data.name,
		version: data.version,
		title: data.title,
		description: data.description,
		code: data.code,
		issuer: data.issuer,
		edition: data.edition,
		language: data.language,
		metadata: data.metadata,
		instructions: data.instructions,
		agentInstructions: data.agentInstructions,

		async contentHash(): Promise<string> {
			return contentHashOf(storedDefinition(originFor(origin, data), data))
		},

		// Validation
		validate(options?: ValidateOptions): StandardSchemaV1.Result<T> {
			return validateArtifact<T>(data, options)
		},

		isValid(options?: ValidateOptions): boolean {
			const result = this.validate(options)
			return !('issues' in result)
		},

		// Serialization
		toJSON(options: SerializationOptions = {}): T {
			return serializableArtifact(data, options.includeSchema ?? true)
		},

		toYAML(options: SerializationOptions = {}): string {
			return toYAML(serializableArtifact(data, options.includeSchema ?? true), options)
		},
	}
}
