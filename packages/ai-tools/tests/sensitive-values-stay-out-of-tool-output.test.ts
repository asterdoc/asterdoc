import { describe, expect, it } from 'vitest'
import { executeFill, executeGetFillState, executeRender } from '../src'

const artifact = {
	kind: 'form' as const,
	name: 'payee',
	fields: {
		account: { type: 'text' as const, mask: '###-####', sensitive: true },
		birthCountry: { type: 'country' as const, sensitive: true },
		code: { type: 'text' as const },
	},
	defs: {
		upperAccount: { type: 'string' as const, value: 'upper(fields.account)' },
		hasAccount: { type: 'boolean' as const, value: 'length(fields.account) > 0' },
		upperCode: { type: 'string' as const, value: 'upper(fields.code)' },
	},
}

describe('sensitive values stay out of AI tool output', () => {
	it('a refused sensitive input is not quoted by fill or get_fill_state', async () => {
		const data = { fields: { account: '000-SECRET', birthCountry: 'SECRETLAND' } }
		const filled = await executeFill({ source: 'artifact', artifact, data })
		const state = await executeGetFillState({ source: 'artifact', artifact, data })

		expect(filled.accepted).toBe(false)
		expect(filled.errors?.map((error) => error.code)).toEqual(['mask_mismatch', 'unknown_country'])
		expect(JSON.stringify(filled)).not.toContain('SECRET')
		expect(state.errors?.length).toBeGreaterThan(0)
		expect(JSON.stringify(state)).not.toContain('SECRET')
	})

	it('get_fill_state redacts a computed value derived from a sensitive field, keeping booleans and other values', async () => {
		const state = await executeGetFillState({ source: 'artifact', artifact, data: { fields: { account: '1234567', code: 'ab' } } })

		expect(state.defs_values).toEqual({
			upperAccount: '[redacted] (string, length 7)',
			hasAccount: true,
			upperCode: 'AB',
		})
	})

	it('a logic error over a sensitive value is reported without the value', async () => {
		const patterned = {
			kind: 'form' as const,
			name: 'patterned',
			fields: {
				pattern: { type: 'text' as const, sensitive: true },
				other: { type: 'text' as const, required: 'matches("abc", fields.pattern)' },
			},
		}
		const state = await executeGetFillState({ source: 'artifact', artifact: patterned, data: { fields: { pattern: '(SECRET' } } })

		expect(state.errors).toEqual([{ code: 'logic_unresolved', message: 'Failed to resolve form expression', path: ['other', 'required'] }])
		expect(JSON.stringify(state)).not.toContain('SECRET')
	})

	it('get_fill_state keeps a count of rows that hold sensitive values', async () => {
		const owned = {
			kind: 'form' as const,
			name: 'owners',
			fields: { owners: { type: 'list' as const, item: { type: 'fieldset' as const, fields: { ssn: { type: 'text' as const, sensitive: true } } } } },
			defs: { ownerCount: { type: 'number' as const, value: 'count(fields.owners)' } },
		}
		const state = await executeGetFillState({ source: 'artifact', artifact: owned, data: { fields: { owners: [{ ssn: '111223333' }] } } })

		expect(state.defs_values).toEqual({ ownerCount: 1 })
	})

	it('a render that cannot mask a sensitive value does not quote it', async () => {
		const masked = {
			kind: 'form' as const,
			name: 'masked',
			fields: { ssn: { type: 'text' as const, sensitive: true } },
			layers: { main: { kind: 'inline' as const, mimeType: 'text/plain', text: '{{ fields.ssn | text.mask="###-##-####" }}' } },
		}
		const output = await executeRender({ source: 'artifact', artifact: masked, data: { fields: { ssn: 'SECRET-SSN-VALUE' } } })

		expect(output.success).toBe(false)
		expect(JSON.stringify(output)).toContain('[redacted] (string, length 16)')
		expect(JSON.stringify(output)).not.toContain('SECRET-SSN-VALUE')
	})

	it('a render that cannot print a sensitive phone number for the box region does not quote it', async () => {
		const phoned = {
			kind: 'form' as const,
			name: 'phoned',
			fields: { phone: { type: 'phone' as const, sensitive: true } },
			layers: {
				national: { kind: 'inline' as const, mimeType: 'text/plain', text: '{{ fields.phone }}', format: { phone: { style: 'national' as const, region: 'US' } } },
				area: { kind: 'inline' as const, mimeType: 'text/plain', text: '{{ fields.phone | part="nationalNumber", phone.region="US" }}' },
			},
		}
		for (const layer of ['national', 'area']) {
			const output = await executeRender({ source: 'artifact', artifact: phoned, layer, data: { fields: { phone: { number: '+442079460958' } } } })
			expect(output.success).toBe(false)
			expect(JSON.stringify(output)).toContain('[redacted] (string, length 13)')
			expect(JSON.stringify(output)).not.toContain('2079460958')
		}
	})

	it('a render that cannot name a sensitive address country does not quote it', async () => {
		const addressed = {
			kind: 'form' as const,
			name: 'addressed',
			fields: { home: { type: 'address' as const, sensitive: true } },
			layers: { main: { kind: 'inline' as const, mimeType: 'text/plain', text: '{{ fields.home | country.display="name" }}' } },
		}
		const home = { line1: '1 Main St', locality: 'Springfield', region: 'Neverwhere', postalCode: '62701', country: 'Atlantisland' }
		const output = await executeRender({ source: 'artifact', artifact: addressed, data: { fields: { home } } })
		expect(output.success).toBe(false)
		expect(JSON.stringify(output)).toContain('[redacted]')
		expect(JSON.stringify(output)).not.toContain('Atlantisland')
	})
})
