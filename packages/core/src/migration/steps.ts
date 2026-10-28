import type { SchemaVersion } from '@asterdoc/schemas'

/** A parsed artifact as a plain JSON object. */
export type ArtifactObject = Record<string, unknown>

/**
 * Converts an artifact from one schema version to the next.
 *
 * `apply` receives a private copy it may change and returns the converted
 * artifact. When it meets a value it cannot convert safely it throws
 * `UnconvertibleValueError` naming the value, and the migration changes nothing.
 */
export interface MigrationStep {
	readonly from: SchemaVersion
	readonly to: SchemaVersion
	/** What the step changes, in one sentence. */
	readonly summary: string
	apply(artifact: ArtifactObject): ArtifactObject
}

/**
 * Every migration step, in version order. Each step leads from one published
 * version to the next, so a chain exists from every version to the current one.
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = []
