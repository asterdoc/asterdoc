import { describe, expect, test } from 'vitest'
import { form } from '@/artifacts'

const lease = () =>
	form({
		kind: 'form',
		name: 'lease',
		version: '1.0.0',
		fields: {
			rent: { type: 'number', label: 'Rent', required: true },
			note: { type: 'text', label: 'Note' },
		},
		parties: {
			tenant: { label: 'Tenant', partyType: 'person', min: 1, max: 1 },
			landlord: { label: 'Landlord', partyType: 'person', min: 1, max: 1 },
		},
	} as any)

const errorsOf = (data: Record<string, unknown>) =>
	lease()
		.fill(data as never)
		.validate()
		.errors.map((error) => [error.field, error.message])

describe('readiness of a draft', () => {
	test('names every missing party and every missing field in one result', () => {
		expect(errorsOf({ fields: { note: 'Ground floor' } })).toEqual([
			['fields.rent', 'Missing required field: fields.rent'],
			['parties.tenant', 'Role "tenant" requires at least 1 party(ies)'],
			['parties.landlord', 'Role "landlord" requires at least 1 party(ies)'],
		])
	})

	test('names only what is still missing as values arrive, and nothing when the data is complete', () => {
		const tenant = { name: 'Dana Ortiz' }
		expect(errorsOf({ fields: { rent: 1200 }, parties: { tenant } })).toEqual([['parties.landlord', 'Role "landlord" requires at least 1 party(ies)']])
		expect(errorsOf({ fields: { rent: 1200 }, parties: { tenant, landlord: { name: 'Sam Reyes' } } })).toEqual([])
	})
})
