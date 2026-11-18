import { describe, expect, it } from 'vitest'
import { validate } from '@/index'

const contact = (phone: Record<string, unknown>) => ({
	kind: 'form' as const,
	name: 'contact',
	version: '1.0.0',
	title: 'Contact',
	fields: { phone: { type: 'phone' as const, label: 'Phone', ...phone } },
})

const messages = (phone: Record<string, unknown>) => (validate(contact(phone) as never).issues ?? []).map((issue) => issue.message)

describe('the countryCode of a phone field', () => {
	it('is accepted when a country\'s plan has it, with a default of that plan', () => {
		expect(messages({ countryCode: '1', default: { number: '+12125551234' } })).toEqual([])
		expect(messages({ countryCode: '44' })).toEqual([])
	})

	it('is accepted for a non-geographic plan, such as international freephone +800, with a default of that plan', () => {
		expect(messages({ countryCode: '800', default: { number: '+80012345678' } })).toEqual([])
	})

	it('is refused when no country\'s plan has it', () => {
		expect(messages({ countryCode: '2' })).toEqual(['+2 is not the country calling code of any country\'s phone plan.'])
	})

	it('refuses a default of another plan whose digits start with the code', () => {
		expect(messages({ countryCode: '2', default: { number: '+201001234567' } })).toEqual(['+2 is not the country calling code of any country\'s phone plan.'])
		expect(messages({ countryCode: '1', default: { number: '+12125551234' } })).toEqual([])
		expect(messages({ countryCode: '4', default: { number: '+447911123456' } })).toEqual(['+4 is not the country calling code of any country\'s phone plan.'])
		expect(messages({ countryCode: '20', default: { number: '+2012345' } })).toEqual(['The default +2012345 is not a valid phone number of the +20 plan this field takes.'])
		expect(messages({ countryCode: '1', default: { number: '+447911123456' } })).toEqual(['The default +447911123456 has country calling code +44; this field takes only +1 numbers.'])
	})
})
