import { describe, expect, test, vi } from 'vitest'
import { SCHEMA_VERSION, SCHEMA_VERSIONS, schemaVersionUrl, type SchemaVersion } from '@asterdoc/schemas'
import { SchemaVersionError, load } from '@/serialization'
import { validate } from '@/validation/artifact'

vi.mock('@/migration/steps', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/migration/steps')>()
	const { SCHEMA_VERSION } = await import('@asterdoc/schemas')
	return { ...actual, MIGRATION_STEPS: actual.MIGRATION_STEPS.filter((step) => step.to !== SCHEMA_VERSION) }
})

const PREVIOUS = SCHEMA_VERSIONS.at(-2) as SchemaVersion
const notice = JSON.stringify({ $schema: schemaVersionUrl(PREVIOUS), kind: 'document', name: 'notice' })

describe('an upgrade this SDK has no step for', () => {
	test('load refuses it as a missing migration path, not as a lossy one', () => {
		let error: unknown
		try {
			load(notice)
		} catch (caught) {
			error = caught
		}
		expect(error).toBeInstanceOf(SchemaVersionError)
		expect((error as SchemaVersionError).code).toBe('no-migration-path')
		expect((error as SchemaVersionError).message).toContain(`No migration step leads from schema version ${PREVIOUS} to ${SCHEMA_VERSION}`)
		expect((error as SchemaVersionError).message).toContain('Update @asterdoc/core')
		expect((error as SchemaVersionError).message).not.toContain('without loss')
	})

	test('validate reports it at $schema', () => {
		expect(validate(JSON.parse(notice)).issues?.[0]).toMatchObject({ path: ['$schema'], message: expect.stringContaining('No migration step') })
	})
})
