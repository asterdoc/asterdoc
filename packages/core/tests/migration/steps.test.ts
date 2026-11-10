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

describe('the 2026-10-28 to 2026-11-06 step', () => {
	const form = {
		$schema: schemaVersionUrl('2026-10-28'),
		kind: 'form',
		name: 'lease',
		version: '1.0.0',
		title: 'Lease',
		fields: { signed: { type: 'date', label: 'Signed on' } },
		defaultLayer: 'pdf',
		layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: './lease.pdf' } },
	}

	test('changes only $schema on a form with fields and a PDF layer', () => {
		const result = migrateArtifact(form)

		expect(result.status).toBe('migrated')
		if (result.status !== 'migrated') return
		expect(result.from).toBe('2026-10-28')
		expect(result.to).toBe(SCHEMA_VERSION)
		const { $schema, ...rest } = result.artifact
		const { $schema: _old, ...before } = form
		expect($schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(rest).toEqual(before)
	})

	test('leaves its input unchanged', () => {
		const input = structuredClone(form)
		migrateArtifact(input)
		expect(input).toEqual(form)
	})
})
