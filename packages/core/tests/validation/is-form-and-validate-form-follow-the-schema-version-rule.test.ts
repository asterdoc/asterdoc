import { describe, expect, test } from 'vitest'
import { SCHEMA_VERSIONS, schemaVersionUrl, type SchemaVersion } from '@asterdoc/schemas'
import { isForm } from '@/validation/type-guards'
import { validateForm } from '@/validation/validators'
import { validate } from '@/validation/artifact'

const PREVIOUS = SCHEMA_VERSIONS.at(-2) as SchemaVersion
const body = { kind: 'form', name: 'intake', fields: { name: { type: 'text' } } }
const earlier = { $schema: schemaVersionUrl(PREVIOUS), ...body }
const newer = { $schema: 'https://schema.asterdoc.com/2999-01-01.json', ...body }

describe('isForm and validateForm follow the schema version rule of validate()', () => {
	test('an earlier $schema is upgraded in memory and accepted by all three', () => {
		expect(validate(earlier).issues).toBeUndefined()
		expect(isForm(earlier)).toBe(true)
		expect(validateForm(earlier).issues).toBeUndefined()
	})

	test('a newer $schema is refused by all three', () => {
		expect(validate(newer).issues?.[0]?.message).toContain('newer than this SDK knows')
		expect(isForm(newer)).toBe(false)
		expect(validateForm(newer).issues?.[0]?.message).toContain('newer than this SDK knows')
	})
})
