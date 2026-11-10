import { describe, expect, it } from 'vitest'
import { canonicalizeFieldValue, fieldInputGuidance } from '@/index'

const complete = { mode: 'complete' as const }

describe('fieldInputGuidance', () => {
	it('describes country input with examples the engine stores as the alpha-2 code', () => {
		const field = { type: 'country' as const }
		const guidance = fieldInputGuidance(field)
		expect(guidance).toContain('Canada, CA or CAN')
		expect(guidance).toContain('candidates')
		for (const input of ['Canada', 'CA', 'CAN']) {
			expect(canonicalizeFieldValue(field, input, complete)).toEqual({ success: true, value: 'CA' })
		}
	})

	it('tells the agent to answer a subdivision picked for a country field with its country code', () => {
		const field = { type: 'country' as const }
		expect(fieldInputGuidance(field)).toContain('the part before the dash (US)')
		const refused = canonicalizeFieldValue(field, 'Georgia', complete)
		expect(refused.success ? [] : refused.issues[0]?.candidates).toContainEqual({ code: 'US-GA', name: 'Georgia, United States' })
		expect(canonicalizeFieldValue(field, 'US', complete)).toEqual({ success: true, value: 'US' })
	})

	it('describes unrestricted region input with examples the engine stores as the full code', () => {
		const field = { type: 'region' as const }
		const guidance = fieldInputGuidance(field)
		expect(guidance).toContain('Ontario or CA-ON')
		expect(guidance).not.toContain('short code')
		for (const input of ['Ontario', 'CA-ON']) {
			expect(canonicalizeFieldValue(field, input, complete)).toEqual({ success: true, value: 'CA-ON' })
		}
	})

	it('names the country of a restricted region field and its short-code input', () => {
		const field = { type: 'region' as const, country: 'US' }
		const guidance = fieldInputGuidance(field)
		expect(guidance).toContain('only subdivisions of US')
		expect(guidance).toContain('US-<short code>')
		for (const input of ['Texas', 'TX', 'US-TX']) {
			expect(canonicalizeFieldValue(field, input, complete)).toEqual({ success: true, value: 'US-TX' })
		}
	})

	it('describes an address that stores codes, and leaves a plain address without guidance', () => {
		const address = { type: 'address' as const, codes: true }
		const guidance = fieldInputGuidance(address)
		expect(guidance).toContain('`country` and `region` take the names or codes')
		expect(guidance).toContain('`region` with the part after it (GA)')
		const picked = { line1: '1 Peachtree St', locality: 'Atlanta', region: 'GA', postalCode: '30303', country: 'US' }
		expect(canonicalizeFieldValue(address, picked, complete)).toEqual({ success: true, value: picked })
		expect(fieldInputGuidance({ type: 'address' })).toBeUndefined()
	})

	it('describes a masked text field, naming the mask shape, with both forms storing without separators', () => {
		const field = { type: 'text' as const, mask: '###-##-####' }
		const guidance = fieldInputGuidance(field)
		expect(guidance).toContain('with or without its separators')
		expect(guidance).toContain('###-##-####')
		expect(guidance).toContain('123-45-6789 or 123456789')
		for (const input of ['123-45-6789', '123456789']) {
			expect(canonicalizeFieldValue(field, input, complete)).toEqual({ success: true, value: '123456789' })
		}
	})

	it('gives no guidance for a text field without a mask or with a mask that does not parse', () => {
		expect(fieldInputGuidance({ type: 'text', mask: '' })).toBeUndefined()
		expect(fieldInputGuidance({ type: 'text', mask: '##\\' })).toBeUndefined()
		expect(fieldInputGuidance({ type: 'email', mask: '###' })).toBeUndefined()
	})

	it('gives no guidance for other fields or for values that are not field definitions', () => {
		expect(fieldInputGuidance({ type: 'text' })).toBeUndefined()
		expect(fieldInputGuidance(null)).toBeUndefined()
		expect(fieldInputGuidance('country')).toBeUndefined()
		expect(fieldInputGuidance([{ type: 'country' }])).toBeUndefined()
	})
})
