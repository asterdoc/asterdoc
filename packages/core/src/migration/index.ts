/**
 * Schema migration: bring an artifact written for an earlier dated schema
 * version up to the current one.
 */

export {
	migrateArtifact,
	migrateArtifactSource,
} from './migrate'

export type {
	MigrateOptions,
	MigrateSourceOptions,
	ArtifactMigration,
	ArtifactSourceMigration,
	ArtifactSourceFormat,
} from './migrate'

export { upgradeArtifact } from './upgrade'
export type { SchemaReadOptions, UpgradeArtifactOptions, UpgradedArtifact } from './upgrade'

export { MIGRATION_STEPS } from './steps'
export type { MigrationStep, ArtifactObject } from './steps'

export { SchemaMigrationError, UnconvertibleValueError } from './errors'
export type { SchemaMigrationErrorCode } from './errors'
