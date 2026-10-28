import { describe, expect, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, SCHEMA_VERSIONS, schemaVersionUrl } from '@asterdoc/schemas'
import { MIGRATION_STEPS, migrateArtifact } from '@/migration'

describe('the published migration steps', () => {
	test('a step leads from every published version to the next, in order', () => {
		const pairs = SCHEMA_VERSIONS.slice(1).map((to, index) => `${SCHEMA_VERSIONS[index]}->${to}`)
		expect(MIGRATION_STEPS.map((step) => `${step.from}->${step.to}`)).toEqual(pairs)
	})

	test('an artifact of every published version reaches the current one', () => {
		for (const version of SCHEMA_VERSIONS) {
			const result = migrateArtifact({ $schema: schemaVersionUrl(version), kind: 'document', name: 'notice' })
			if (version === SCHEMA_VERSION) expect(result.status).toBe('current')
			else expect(result).toMatchObject({ status: 'migrated', from: version, to: SCHEMA_VERSION, artifact: { $schema: ASTERDOC_SCHEMA_URL } })
		}
	})
})
