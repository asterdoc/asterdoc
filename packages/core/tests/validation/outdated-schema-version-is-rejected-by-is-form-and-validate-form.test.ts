/**
 * core-054: isForm / validateForm accept an outdated $schema that parseForm and validate reject.
 * Input: a valid form object whose $schema names an earlier published version.
 * Expected: isForm false and validateForm fails, matching validate() and parseForm.
 * Actual (screened commit): isForm true, validateForm success, while validate() reports outdated-version.
 */
import { describe, expect, test, vi } from 'vitest'
import { isForm } from '@/validation/type-guards'
import { validateForm } from '@/validation/validators'
import { validate } from '@/validation/artifact'
import { EARLIER, earlierUrl } from '../schema-history'

vi.mock('@asterdoc/schemas', async (importOriginal) => {
	const { withEarlierVersions } = await import('../schema-history')
	return withEarlierVersions(await importOriginal())
})

const outdated = { $schema: earlierUrl(EARLIER), kind: 'form', name: 'intake', fields: { name: { type: 'text' } } }

describe('isForm and validateForm reject an outdated $schema', () => {
	test('control: validate() rejects the outdated $schema', () => {
		const r = validate(outdated)
		expect(r.issues).toBeDefined()
	})
	test('isForm rejects the outdated $schema', () => {
		expect(isForm(outdated)).toBe(false)
	})
	test('validateForm rejects the outdated $schema', () => {
		const r = validateForm(outdated) as unknown
		expect(JSON.stringify(r)).toMatch(/version|schema/i)
	})
})
