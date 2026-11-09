import { describe, expect, test } from 'vitest'
import { a } from '@/artifacts'
import { canonicalizeFieldValue, placeDisplayNames, runtimeFormFromJSON } from '@/index'
import { validate, validateLayers } from '@/validation/artifact'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import type { FormValidationError } from '@/artifacts/form/form'

const definition = {
	kind: 'form' as const,
	name: 'places',
	version: '1.0.0',
	fields: {
		birthCountry: { type: 'country' as const, label: 'Country of birth' },
		state: { type: 'region' as const, label: 'State', country: 'US' },
		province: { type: 'region' as const, label: 'Province or state' },
		home: { type: 'address' as const, label: 'Home', codes: true },
		mailing: { type: 'address' as const, label: 'Mailing' },
		previous: {
			type: 'list' as const,
			item: { type: 'fieldset' as const, fields: { country: { type: 'country' as const }, address: { type: 'address' as const, codes: true } } },
		},
	},
}

const form = () => a.form(definition)
const draft = () => form().fill({ fields: {} })
const errorsOf = (run: () => unknown) => {
	try {
		run()
	} catch (error) {
		return (error as FormValidationError).errors
	}
	throw new Error('expected the write to be refused')
}

const address = { line1: '1 Bay St', locality: 'Toronto', postalCode: 'M5J 2N8' }

describe('a country field', () => {
	test('stores an alpha-2 code for a code, an alpha-3 code or an English name', () => {
		expect(draft().update({ fields: { birthCountry: 'ca' } }).fields.birthCountry).toBe('CA')
		expect(draft().update({ fields: { birthCountry: 'CAN' } }).fields.birthCountry).toBe('CA')
		expect(draft().update({ fields: { birthCountry: 'Canada' } }).fields.birthCountry).toBe('CA')
		expect(form().fill({ fields: { birthCountry: 'United Kingdom' } }).fields.birthCountry).toBe('GB')
	})

	test('accepts a name in the input locale through validateFieldInput', () => {
		expect(form().validateFieldInput({ fieldPath: 'birthCountry', value: 'Allemagne', locale: 'fr-FR' })).toMatchObject({ success: true, value: 'DE' })
		expect(form().validateFieldInput({ fieldPath: 'birthCountry', value: 'Allemagne' })).toMatchObject({ success: false })
	})

	test('refuses a name of a country and of another country\'s subdivision with every candidate', () => {
		expect(errorsOf(() => draft().update({ fields: { birthCountry: 'Georgia' } }))).toEqual([{
			field: 'fields.birthCountry',
			message: expect.any(String),
			code: 'ambiguous_country',
			candidates: [{ code: 'GE', name: 'Georgia' }, { code: 'US-GA', name: 'Georgia' }],
		}])
	})

	test('refuses an unknown country with up to five nearest candidates, and a former code', () => {
		const [unknown] = errorsOf(() => draft().update({ fields: { birthCountry: 'Canda' } }))
		expect(unknown).toMatchObject({ code: 'unknown_country', field: 'fields.birthCountry' })
		expect(unknown?.candidates?.length).toBeLessThanOrEqual(5)
		expect(unknown?.candidates?.[0]).toEqual({ code: 'CA', name: 'Canada' })
		expect(errorsOf(() => draft().update({ fields: { birthCountry: 'YU' } }))[0]).toMatchObject({ code: 'unknown_country' })
	})

	test('returns the structured issue from safeUpdate and validateFieldInput', () => {
		const result = draft().safeUpdate({ fields: { birthCountry: 'Congo' } })
		expect(result.success).toBe(false)
		expect(result.success ? [] : (result.error as FormValidationError).errors[0]?.candidates?.map((candidate) => candidate.code)).toEqual(['CD', 'CG'])
		expect(form().validateFieldInput({ fieldPath: 'birthCountry', value: 'Congo' })).toMatchObject({
			success: false,
			errors: [{ field: 'fields.birthCountry', code: 'ambiguous_country', candidates: [{ code: 'CD' }, { code: 'CG' }] }],
		})
	})
})

describe('a region field', () => {
	test('stores the full code for a full code, a short code under its country, or a name', () => {
		expect(draft().update({ fields: { state: 'us-ca' } }).fields.state).toBe('US-CA')
		expect(draft().update({ fields: { state: 'CA' } }).fields.state).toBe('US-CA')
		expect(draft().update({ fields: { state: 'California' } }).fields.state).toBe('US-CA')
		expect(draft().update({ fields: { province: 'Ontario' } }).fields.province).toBe('CA-ON')
	})

	test('keeps to its country constraint', () => {
		expect(errorsOf(() => draft().update({ fields: { state: 'CA-ON' } }))[0]).toMatchObject({ code: 'unknown_region', field: 'fields.state' })
		expect(errorsOf(() => draft().update({ fields: { state: 'Ontario' } }))[0]).toMatchObject({ code: 'unknown_region' })
	})

	test('needs a country for a short code, and reports a shared name as ambiguous', () => {
		expect(errorsOf(() => draft().update({ fields: { province: 'ON' } }))[0]).toMatchObject({ code: 'needs_country', candidates: [] })
		expect(errorsOf(() => draft().update({ fields: { province: 'Victoria' } }))[0]).toMatchObject({
			code: 'ambiguous_region',
			candidates: [{ code: 'AU-VIC', name: 'Victoria' }, { code: 'MT-45', name: 'Victoria' }],
		})
	})
})

describe('an address field', () => {
	test('with codes: true stores the country and region as codes', () => {
		const filled = draft().update({ fields: { home: { ...address, region: 'Ontario', country: 'Canada' } } })
		expect(filled.fields.home).toEqual({ ...address, region: 'ON', country: 'CA' })
		expect(draft().update({ fields: { home: { ...address, region: 'CA-ON', country: 'CAN' } } }).fields.home).toMatchObject({ region: 'ON', country: 'CA' })
	})

	test('without codes stores what it is given', () => {
		expect(draft().update({ fields: { mailing: { ...address, region: 'Ontario', country: 'Canada' } } }).fields.mailing)
			.toEqual({ ...address, region: 'Ontario', country: 'Canada' })
	})

	test('with codes: true refuses a region of another country and a region without a country', () => {
		expect(errorsOf(() => draft().update({ fields: { home: { ...address, region: 'Texas', country: 'CA' } } }))[0])
			.toMatchObject({ code: 'unknown_region', field: 'fields.home.region' })
		expect(errorsOf(() => draft().update({ fields: { home: { ...address, region: 'Ontario' } } }))[0])
			.toMatchObject({ code: 'needs_country', field: 'fields.home.region' })
	})

	test('keeps a region exactly as given in a country without subdivisions, and refuses a full code of another country', () => {
		expect(draft().update({ fields: { home: { ...address, region: ' Vatican City ', country: 'VA' } } }).fields.home).toMatchObject({ region: ' Vatican City ', country: 'VA' })
		expect(errorsOf(() => draft().update({ fields: { home: { ...address, region: 'US-CA', country: 'VA' } } }))[0])
			.toMatchObject({ code: 'unknown_region', field: 'fields.home.region' })
	})

	test('canonicalizes a patch merged over the stored address', () => {
		const stored = draft().update({ fields: { home: { ...address, region: 'ON', country: 'CA' } } })
		expect(stored.update({ fields: { home: { region: 'Quebec' } } }).fields.home).toEqual({ ...address, region: 'QC', country: 'CA' })
		expect(errorsOf(() => stored.update({ fields: { home: { country: 'US' } } }))[0]).toMatchObject({ code: 'unknown_region', field: 'fields.home.region' })
		const refused = stored.safeUpdate({ fields: { home: { country: 'US' } } })
		expect(refused.success ? undefined : (refused.error as FormValidationError).errors[0]?.code).toBe('unknown_region')
		const moved = stored.safeUpdate({ fields: { home: { country: 'United States', region: 'Texas' } } })
		expect(moved.success && moved.data.fields.home).toEqual({ ...address, region: 'TX', country: 'US' })
	})

	test('merges a patch to an address without codes as before', () => {
		const stored = draft().update({ fields: { mailing: { ...address, region: 'ON', country: 'CA' } } })
		expect(stored.update({ fields: { mailing: { region: 'Quebec' } } }).fields.mailing).toEqual({ ...address, region: 'Quebec', country: 'CA' })
		expect(stored.update({ fields: { mailing: { country: 'US' } } }).fields.mailing).toEqual({ ...address, region: 'ON', country: 'US' })
	})

	test('canonicalizes a member written on its own, reading a region in its address', () => {
		expect(form().validateFieldInput({ fieldPath: 'home.country', value: 'Canada' })).toMatchObject({ success: true, value: 'CA' })
		expect(form().validateFieldInput({ fieldPath: 'home.country', value: 'Georgia' })).toMatchObject({
			success: false,
			errors: [{ field: 'fields.home.country', code: 'ambiguous_country', candidates: [{ code: 'GE' }, { code: 'US-GA' }] }],
		})
		expect(form().validateFieldInput({ fieldPath: 'home.region', value: 'Ontario', owner: { country: 'CA' } })).toMatchObject({ success: true, value: 'ON' })
		expect(form().validateFieldInput({ fieldPath: 'home.region', value: 'Ontario' })).toMatchObject({ success: false, errors: [{ code: 'needs_country', field: 'fields.home.region' }] })
		expect(form().validateFieldInput({ fieldPath: 'previous.0.address.region', value: 'Texas', owner: { country: 'United States' } })).toMatchObject({ success: true, value: 'TX' })
		expect(form().validateFieldInput({ fieldPath: 'mailing.country', value: 'Canada' })).toMatchObject({ success: true, value: 'Canada' })
	})

	test('refuses a country member that does not contain the region already stored in its address', () => {
		expect(form().validateFieldInput({ fieldPath: 'home.country', value: 'US', owner: { country: 'CA', region: 'ON' } })).toMatchObject({
			success: false,
			errors: [{ field: 'fields.home.region', code: 'unknown_region' }],
		})
		expect(form().validateFieldInput({ fieldPath: 'home.country', value: 'Canada', owner: { country: 'US', region: 'ON' } })).toMatchObject({ success: true, value: 'CA' })
	})
})

describe('canonical values in lists and fieldsets', () => {
	test('are stored for every item and member, with issues naming the item path', () => {
		const filled = draft().update({ fields: { previous: [{ country: 'France', address: { ...address, region: 'Quebec', country: 'Canada' } }] } })
		expect(filled.fields.previous).toEqual([{ country: 'FR', address: { ...address, region: 'QC', country: 'CA' } }])
		expect(errorsOf(() => draft().update({ fields: { previous: [{ country: 'FR' }, { country: 'Georgia' }] } }))[0])
			.toMatchObject({ field: 'fields.previous.1.country', code: 'ambiguous_country' })
	})

	test('are idempotent: a canonical value canonicalizes to itself', () => {
		const field = definition.fields.home
		const value = { ...address, region: 'ON', country: 'CA' }
		expect(canonicalizeFieldValue(field, value, { mode: 'complete' })).toEqual({ success: true, value })
	})

	test('leave every other field type untouched', () => {
		expect(canonicalizeFieldValue({ type: 'text' }, ' Canada ', { mode: 'complete' })).toEqual({ success: true, value: ' Canada ' })
	})
})

describe('restoring a draft', () => {
	test('canonicalizes stored values and refuses one that names no place', () => {
		const json = draft().update({ fields: { birthCountry: 'CA' } }).toJSON()
		expect(runtimeFormFromJSON({ ...json, fields: { birthCountry: 'Canada' } }).fields.birthCountry).toBe('CA')
		expect(() => runtimeFormFromJSON({ ...json, fields: { birthCountry: 'Atlantis' } })).toThrow('No country matches')
	})
})

describe('design-time checks', () => {
	test('accept codes in defaults and in a region country constraint', () => {
		expect(validate({ ...definition, fields: { c: { type: 'country', default: 'CA' }, r: { type: 'region', country: 'US', default: 'US-TX' } } }).issues).toBeUndefined()
		expect(form().fill({ fields: {} }).fields).toEqual({})
		expect(a.form({ ...definition, fields: { c: { type: 'country', default: 'CA' } } }).fill({ fields: {} }).fields.c).toBe('CA')
	})

	test('refuse a code that is not in the shipped lists', () => {
		expect(validate({ ...definition, fields: { c: { type: 'country', default: 'XX' } } }).issues).toEqual([{ path: ['fields', 'c', 'default'], message: expect.stringContaining('"XX"') }])
		expect(validate({ ...definition, fields: { r: { type: 'region', country: 'ZZ' } } }).issues).toEqual([{ path: ['fields', 'r', 'country'], message: expect.stringContaining('"ZZ"') }])
		expect(validate({ ...definition, fields: { r: { type: 'region', country: 'US', default: 'CA-ON' } } }).issues?.[0]?.message).toContain('not a subdivision of US')
		expect(validate({ ...definition, fields: { h: { type: 'address', codes: true, default: { ...address, region: 'Ontario', country: 'CA' } } } }).issues?.[0]?.message)
			.toContain('write the default with them')
	})

	test('refuse a lower-case code in the schema', () => {
		expect(validate({ ...definition, fields: { c: { type: 'country', default: 'ca' } } }).issues).toBeDefined()
	})
})

describe('display names for stored codes', () => {
	test('name each country and region with its country', () => {
		const filled = draft().update({ fields: { birthCountry: 'DE', province: 'CA-ON', home: { ...address, region: 'ON', country: 'CA' }, mailing: { ...address, region: 'ON', country: 'CA' } } })
		expect(placeDisplayNames(definition.fields, filled.fields)).toEqual({
			'fields.birthCountry': 'Germany',
			'fields.province': 'Ontario, Canada',
			'fields.home.country': 'Canada',
			'fields.home.region': 'Ontario, Canada',
		})
	})
})

describe('layers that print countries or subdivisions', () => {
	const withLayer = (fields: Record<string, unknown>, format: Record<string, unknown>) => ({
		kind: 'form' as const,
		name: 'places',
		version: '1.0.0',
		fields,
		layers: { notes: { kind: 'inline' as const, mimeType: 'text/markdown', text: '{{fields.mailing}}', format } },
	})
	const resolver = createMemoryResolver({ contents: {} })

	test('warn about a stored default that does not normalize', async () => {
		const result = await validateLayers(withLayer({ mailing: { type: 'address', default: { ...address, region: 'Ontario', country: 'Atlantis' } } }, { country: { display: 'name' } }), { resolver })
		expect(result.issues).toBeUndefined()
		expect(result.warnings).toEqual([expect.objectContaining({ severity: 'warning', path: ['fields', 'mailing', 'default', 'country'], message: expect.stringContaining('Layer "notes"') })])
	})

	test('stay quiet when stored defaults normalize or no layer prints places', async () => {
		const fields = { mailing: { type: 'address', default: { ...address, region: 'Ontario', country: 'Canada' } } }
		expect((await validateLayers(withLayer(fields, { region: { display: 'name' } }), { resolver })).warnings).toBeUndefined()
		const atlantis = { mailing: { type: 'address', default: { ...address, region: 'Ontario', country: 'Atlantis' } } }
		expect((await validateLayers(withLayer(atlantis, { locale: 'en-US' }), { resolver })).warnings).toBeUndefined()
	})
})
