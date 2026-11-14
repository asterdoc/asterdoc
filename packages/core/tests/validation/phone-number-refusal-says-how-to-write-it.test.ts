import { describe, expect, test } from 'vitest'
import { form } from '@/artifacts'

const contact = () =>
	form({
		kind: 'form',
		name: 'contact',
		version: '1.0.0',
		fields: {
			phone: { type: 'phone', label: 'Telephone' },
			initials: { type: 'text', label: 'Initials', pattern: '^[A-Z]+$' },
		},
	} as any)

const refusal = (fields: Record<string, unknown>) => {
	const filled = contact().safeFill({ fields } as never)
	if (filled.success) return []
	return (filled.error as { errors?: Array<{ field: string; message: string }> }).errors ?? []
}

describe('a phone number the form refuses', () => {
	test('is refused with the written form the number must have', () => {
		for (const number of ['6145550142', '(614) 555-0142', '+1 614 555 0142']) {
			expect(refusal({ phone: { number } })).toEqual([
				expect.objectContaining({
					field: 'fields.phone.number',
					message: 'Must be the full international number with no spaces or marks: +, the country code, the national number, such as +14155552671',
				}),
			])
		}
	})

	test('is accepted in that form', () => {
		expect(contact().safeFill({ fields: { phone: { number: '+16145550142' } } } as never).success).toBe(true)
	})

	test('leaves the general message for a pattern the form author wrote', () => {
		expect(refusal({ initials: 'nc' })).toEqual([expect.objectContaining({ field: 'fields.initials', message: 'Does not match required pattern' })])
	})
})
