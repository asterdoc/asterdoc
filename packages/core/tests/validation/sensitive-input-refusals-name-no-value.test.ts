import { describe, expect, test } from 'vitest'
import type { Form } from '@asterdoc/types'
import { form, FormValidationError } from '@/artifacts'
import { validateFieldInput } from '@/validation/progressive'

const definition: Form = {
	kind: 'form',
	name: 'payee',
	version: '1.0.0',
	title: 'Payee',
	fields: {
		account: { type: 'text', mask: '###-####', sensitive: true },
		code: { type: 'text', mask: '###-####' },
		birthCountry: { type: 'country', sensitive: true },
		country: { type: 'country' },
		private: {
			type: 'fieldset',
			sensitive: true,
			fields: {
				province: { type: 'region', country: 'CA' },
				home: { type: 'address', codes: true },
			},
		},
		history: { type: 'list', sensitive: true, item: { type: 'country' } },
	},
}

const refusal = (fields: Record<string, unknown>) => {
	const result = form(definition).safeFill({ fields } as never)
	if (result.success) throw new Error('expected a refusal')
	expect(result.error).toBeInstanceOf(FormValidationError)
	return result.error as FormValidationError
}

describe('a refused sensitive input is named by kind and length only', () => {
	test('a masked value that does not fit', () => {
		const error = refusal({ account: '000-SECRET' })
		expect(error.errors).toMatchObject([{
			field: 'fields.account',
			code: 'mask_mismatch',
			message: '[redacted] (string, length 10) is not the start of a value written in canonical form. Expected ###-####: 7 digits, written 123-4567 or 1234567.',
			candidates: [],
		}])
		expect(error.message).not.toContain('SECRET')
	})

	test('a country that names no country, with no candidates', () => {
		const error = refusal({ birthCountry: 'SECRETLAND' })
		expect(error.errors).toMatchObject([{ code: 'unknown_country', message: 'No country matches [redacted] (string, length 10).', candidates: [] }])
	})

	test('a region and an address member under a sensitive fieldset', () => {
		const error = refusal({ private: { province: 'SECRETREGION', home: { country: 'CA', region: 'SECRETPLACE' } } })
		expect(error.errors.map((entry) => entry.code)).toEqual(['unknown_region', 'unknown_region'])
		expect(JSON.stringify(error.errors)).not.toMatch(/SECRET/)
		expect(error.errors.every((entry) => entry.candidates?.length === 0)).toBe(true)
	})

	test('an element of a sensitive list', () => {
		expect(JSON.stringify(refusal({ history: ['SECRETLAND'] }).errors)).not.toContain('SECRETLAND')
	})

	test('a progressive input to a field under a sensitive fieldset', () => {
		const result = validateFieldInput(definition, { fieldPath: 'private.province', value: 'SECRETREGION' })
		expect(result.success).toBe(false)
		expect(JSON.stringify(result.errors)).not.toContain('SECRETREGION')
	})

	test('a field that is not sensitive keeps quoting its input and offering candidates', () => {
		const error = refusal({ code: '000-ABCDEF', country: 'Cnada' })
		expect(error.errors[0]?.message).toContain('000-ABCDEF')
		expect(error.errors[1]?.message).toContain('Cnada')
		expect(error.errors[1]?.candidates?.length).toBeGreaterThan(0)
	})
})
