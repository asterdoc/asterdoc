import { describe, expect, it } from 'vitest'
import { fieldInputGuidance } from '@asterdoc/core'
import { ToolErrorSchema } from '../src/contracts'
import { executeFill } from '../src/tools/fill'
import { executeInspectArtifact } from '../src/tools/inspect-artifact'
import { executeUpdateFill } from '../src/tools/update-fill'
import { executeValidateInput } from '../src/tools/validate-input'

const artifact = {
	kind: 'form' as const,
	name: 'places',
	fields: {
		client_address: { type: 'address', label: 'Client address', codes: true },
		birth_country: { type: 'country', label: 'Country of birth' },
		state: { type: 'region', label: 'State', country: 'US' },
		notes: { type: 'text', label: 'Notes' },
	},
}

const address = { line1: '1 Bay St', locality: 'Toronto', postalCode: 'M5J 2N8' }

describe('filling country and region values through the agent tools', () => {
	it('stores codes for names and returns their words beside the data', async () => {
		const result = await executeFill({ source: 'artifact', artifact, data: { fields: { client_address: { ...address, region: 'Ontario', country: 'Canada' }, birth_country: 'Germany' } } })
		expect(result.accepted).toBe(true)
		expect(result.data?.fields).toEqual({ client_address: { ...address, region: 'ON', country: 'CA' }, birth_country: 'DE' })
		expect(result.display).toEqual({
			'fields.client_address.country': 'Canada',
			'fields.client_address.region': 'Ontario, Canada',
			'fields.birth_country': 'Germany',
		})
	})

	it('returns no display map when nothing stores codes', async () => {
		const result = await executeFill({ source: 'artifact', artifact, data: { fields: { notes: 'Canada' } } })
		expect(result.accepted).toBe(true)
		expect(result.display).toBeUndefined()
		expect(result.data?.fields).toEqual({ notes: 'Canada' })
	})

	it('refuses a name of more than one place with every candidate', async () => {
		const result = await executeFill({ source: 'artifact', artifact, data: { fields: { birth_country: 'Georgia' } } })
		expect(result.accepted).toBe(false)
		expect(result.errors).toEqual([{
			code: 'ambiguous_country',
			message: expect.any(String),
			path: ['fields', 'birth_country'],
			candidates: [{ code: 'GE', name: 'Georgia' }, { code: 'US-GA', name: 'Georgia, United States' }],
		}])
		expect(result.errors?.every((error) => ToolErrorSchema.safeParse(error).success)).toBe(true)
	})

	it('updates a draft with a name and returns its words', async () => {
		const result = await executeUpdateFill({ source: 'artifact', artifact, data: { fields: {} }, patch: { fields: { state: 'Texas' } } })
		expect(result.data?.fields).toEqual({ state: 'US-TX' })
		expect(result.display).toEqual({ 'fields.state': 'Texas, United States' })
	})

	it('reads a patched region in the stored address country', async () => {
		const data = { fields: { client_address: { ...address, region: 'ON', country: 'CA' } } }
		const moved = await executeUpdateFill({ source: 'artifact', artifact, data, patch: { fields: { client_address: { region: 'Quebec' } } } })
		expect(moved.data?.fields).toEqual({ client_address: { ...address, region: 'QC', country: 'CA' } })
		expect(moved.display).toMatchObject({ 'fields.client_address.region': 'Quebec, Canada' })
		const refused = await executeUpdateFill({ source: 'artifact', artifact, data, patch: { fields: { client_address: { country: 'US' } } } })
		expect(refused.accepted).toBe(false)
		expect(refused.errors?.[0]).toMatchObject({ code: 'unknown_region', path: ['fields', 'client_address', 'region'] })
	})

	it('refuses an unknown subdivision on update with nearest candidates', async () => {
		const result = await executeUpdateFill({ source: 'artifact', artifact, data: { fields: {} }, patch: { fields: { state: 'Texaz' } } })
		expect(result.accepted).toBe(false)
		expect(result.errors?.[0]).toMatchObject({ code: 'unknown_region', path: ['fields', 'state'] })
		expect(result.errors?.[0]?.candidates?.[0]).toEqual({ code: 'US-TX', name: 'Texas, United States' })
	})

	it('validates one input to its code, keeping candidates on a refusal', async () => {
		expect(await executeValidateInput({ source: 'artifact', artifact, target: 'field', field_path: 'birth_country', value: 'can' }))
			.toMatchObject({ valid: true, normalized_value: 'CA' })
		expect((await executeValidateInput({ source: 'artifact', artifact, target: 'field', field_path: 'birth_country', value: 'Congo' })).errors?.[0])
			.toMatchObject({ code: 'ambiguous_country', candidates: [{ code: 'CD' }, { code: 'CG' }] })
	})

	it('tells the agent that country and region fields take names or codes, in core guidance words', async () => {
		const result = await executeInspectArtifact({ source: 'artifact', artifact, sections: ['fields'] })
		const fields = result.sections?.fields as Record<string, { input?: string; codes?: boolean; country?: string }>
		expect(fields.birth_country?.input).toBe(fieldInputGuidance(artifact.fields.birth_country))
		expect(fields.birth_country?.input).toContain('ISO 3166-1')
		expect(fields.state).toMatchObject({ country: 'US' })
		expect(fields.state?.input).toBe(fieldInputGuidance(artifact.fields.state))
		expect(fields.state?.input).toContain('only subdivisions of US')
		expect(fields.client_address).toMatchObject({ codes: true })
		expect(fields.client_address?.input).toBe(fieldInputGuidance(artifact.fields.client_address))
		expect(fields.client_address?.input).toContain('names or codes')
		expect(fields.notes?.input).toBeUndefined()
	})
})
