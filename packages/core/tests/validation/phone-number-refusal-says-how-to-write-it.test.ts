import { describe, expect, test } from 'vitest'
import { form } from '@/artifacts'

const contact = async () =>
	await form.load({
		kind: 'form',
		name: 'contact',
		version: '1.0.0',
		fields: {
			phone: { type: 'phone', label: 'Telephone' },
			initials: { type: 'text', label: 'Initials', pattern: '^[A-Z]+$' },
		},
	} as any)

const refusal = async (fields: Record<string, unknown>) => {
	const filled = (await contact()).safeFill({ fields } as never)
	if (filled.success) return []
	return (filled.error as { errors?: Array<{ field: string; message: string }> }).errors ?? []
}

describe('a phone number the form refuses', () => {
	test('is refused with the written form the number must have', async () => {
		for (const number of ['6145550142', '(614) 555-0142', '+1 614 555 0142']) {
			expect(await refusal({ phone: { number } })).toEqual([
				expect.objectContaining({
					field: 'fields.phone.number',
					message: 'Must be the full international number with no spaces or marks: +, the country code, the national number, such as +14155552671',
				}),
			])
		}
	})

	test('is accepted in that form', async () => {
		expect((await contact()).safeFill({ fields: { phone: { number: '+16145550142' } } } as never).success).toBe(true)
	})

	test('leaves the general message for a pattern the form author wrote', async () => {
		expect(await refusal({ initials: 'nc' })).toEqual([expect.objectContaining({ field: 'fields.initials', message: 'Does not match required pattern' })])
	})
})

describe('a phone field that states its country calling code', () => {
	const plan = async (sensitive = false) =>
		await form.load({
			kind: 'form',
			name: 'contact',
			version: '1.0.0',
			fields: { phone: { type: 'phone', label: 'Telephone', countryCode: '1', sensitive } },
		} as any)
	const errors = async (number: string, sensitive = false) => {
		const filled = (await plan(sensitive)).safeFill({ fields: { phone: { number } } } as never)
		return filled.success ? [] : (filled.error as { errors?: Array<{ field: string; message: string; code?: string }> }).errors ?? []
	}

	test('takes a valid number of that plan', async () => {
		expect(await errors('+12125551234')).toEqual([])
	})

	test('refuses a number of another plan, naming both codes', async () => {
		expect(await errors('+442079460958')).toEqual([expect.objectContaining({
			field: 'fields.phone.number',
			code: 'phone_country_code',
			message: '+442079460958 has country calling code +44; this field takes only +1 numbers.',
		})])
	})

	test('refuses a number that is not valid in the plan, which its parts could not print', async () => {
		expect(await errors('+15555550100')).toEqual([expect.objectContaining({ field: 'fields.phone.number', code: 'invalid_phone' })])
	})

	test('names a sensitive number only as redacted', async () => {
		const [error] = (await errors('+442079460958', true))
		expect(error?.message).toBe('[redacted] (string, length 13) has country calling code +44; this field takes only +1 numbers.')
	})

	test('leaves a field without a country calling code as it was: any number in the international form', async () => {
		expect((await contact()).safeFill({ fields: { phone: { number: '+15555550100' } } } as never).success).toBe(true)
	})
})
