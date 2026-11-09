import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import {
	COUNTRY_CODES,
	countryName,
	displayRegion,
	isCountryCode,
	resolveCountry,
	resolveRegion,
} from '../src/index'
import { regionsProvider as regions } from '../src/regions'

const require = createRequire(import.meta.url)

function cldrAlpha3(): Record<string, string> {
	const file = require.resolve('cldr-core/supplemental/codeMappings.json')
	const mappings = JSON.parse(readFileSync(file, 'utf8')).supplemental.codeMappings as Record<string, { _alpha3?: string }>
	return Object.fromEntries(Object.entries(mappings).flatMap(([code, entry]) => (entry._alpha3 ? [[code, entry._alpha3]] : [])))
}

describe('the ISO 3166-1 code list', () => {
	it('holds the 249 officially assigned alpha-2 codes', () => {
		expect(Object.keys(COUNTRY_CODES)).toHaveLength(249)
	})

	it('pairs every alpha-2 code with the alpha-3 code CLDR records for it', () => {
		const alpha3 = cldrAlpha3()
		for (const [alpha2, code] of Object.entries(COUNTRY_CODES)) expect([alpha2, code]).toEqual([alpha2, alpha3[alpha2]])
	})

	it('leaves out former, reserved and user-assigned codes', () => {
		for (const code of ['YU', 'AN', 'CS', 'SU', 'ZR', 'TP', 'BU', 'DD', 'EU', 'UK', 'XK', 'ZZ', 'AA']) {
			expect(isCountryCode(code)).toBe(false)
		}
	})
})

describe('resolveCountry', () => {
	it('accepts an alpha-2 code in any case and stores it in upper case', () => {
		expect(resolveCountry('ca')).toEqual({ ok: true, value: 'CA' })
		expect(resolveCountry(' US ')).toEqual({ ok: true, value: 'US' })
	})

	it('maps an alpha-3 code to its alpha-2 code', () => {
		expect(resolveCountry('CAN')).toEqual({ ok: true, value: 'CA' })
		expect(resolveCountry('gbr')).toEqual({ ok: true, value: 'GB' })
	})

	it('accepts English names and aliases, ignoring case, accents and punctuation', () => {
		expect(resolveCountry('Canada', { regions })).toEqual({ ok: true, value: 'CA' })
		expect(resolveCountry('united states of america', { regions })).toEqual({ ok: true, value: 'US' })
		expect(resolveCountry('UK', { regions })).toEqual({ ok: true, value: 'GB' })
		expect(resolveCountry("Cote d'Ivoire", { regions })).toEqual({ ok: true, value: 'CI' })
		expect(resolveCountry('Saint Kitts and Nevis', { regions })).toEqual({ ok: true, value: 'KN' })
	})

	it('accepts a name in the input locale only when that locale is given', () => {
		expect(resolveCountry('Allemagne', { regions, locale: 'fr-FR' })).toEqual({ ok: true, value: 'DE' })
		const english = resolveCountry('Allemagne', { regions })
		expect(english.ok).toBe(false)
		expect(english.ok ? undefined : english.code).toBe('unknown_country')
	})

	it('refuses an unknown country with up to five nearest candidates', () => {
		const outcome = resolveCountry('Canda', { regions })
		expect(outcome).toMatchObject({ ok: false, code: 'unknown_country' })
		if (outcome.ok) return
		expect(outcome.candidates.length).toBeLessThanOrEqual(5)
		expect(outcome.candidates[0]).toEqual({ code: 'CA', name: 'Canada' })
	})

	it('refuses former ISO 3166-3 codes', () => {
		expect(resolveCountry('YU', { regions })).toMatchObject({ ok: false, code: 'unknown_country' })
		expect(resolveCountry('ZAR', { regions })).toMatchObject({ ok: false, code: 'unknown_country' })
	})

	it('reports a name of more than one country as ambiguous with every candidate', () => {
		const outcome = resolveCountry('Congo', { regions })
		expect(outcome).toMatchObject({ ok: false, code: 'ambiguous_country' })
		expect(outcome.ok ? [] : outcome.candidates.map((candidate) => candidate.code)).toEqual(['CD', 'CG'])
	})

	it('reports a name of a country and of another country\'s subdivision as ambiguous', () => {
		const outcome = resolveCountry('Georgia', { regions })
		expect(outcome).toEqual({
			ok: false,
			code: 'ambiguous_country',
			message: expect.any(String),
			candidates: [{ code: 'GE', name: 'Georgia' }, { code: 'US-GA', name: 'Georgia' }],
		})
	})

	it('resolves a name shared with a subdivision of the same country or the same territory', () => {
		expect(resolveCountry('Mexico', { regions })).toEqual({ ok: true, value: 'MX' })
		expect(resolveCountry('Puerto Rico', { regions })).toEqual({ ok: true, value: 'PR' })
	})

	it('refuses a name without the regions provider and still accepts codes', () => {
		expect(resolveCountry('Canada')).toMatchObject({ ok: false, code: 'missing_format_provider' })
		expect(resolveCountry('Canada').ok ? '' : (resolveCountry('Canada') as { message: string }).message).toContain('@asterdoc/format/regions')
		expect(resolveCountry('CAN')).toEqual({ ok: true, value: 'CA' })
	})
})

describe('resolveRegion', () => {
	it('accepts a full ISO 3166-2 code in any case', () => {
		expect(resolveRegion('ca-on', { regions })).toEqual({ ok: true, value: 'CA-ON' })
	})

	it('accepts the code after the dash when the country is known', () => {
		expect(resolveRegion('on', { regions, country: 'CA' })).toEqual({ ok: true, value: 'CA-ON' })
	})

	it('needs a country for a code after the dash', () => {
		expect(resolveRegion('ON', { regions })).toMatchObject({ ok: false, code: 'needs_country', candidates: [] })
	})

	it('accepts a subdivision name within the country and globally', () => {
		expect(resolveRegion('Ontario', { regions, country: 'CA' })).toEqual({ ok: true, value: 'CA-ON' })
		expect(resolveRegion('ontario', { regions })).toEqual({ ok: true, value: 'CA-ON' })
		expect(resolveRegion('Washington, D.C.', { regions })).toEqual({ ok: true, value: 'US-DC' })
	})

	it('reports a name used in more than one country as ambiguous with every candidate', () => {
		const outcome = resolveRegion('Victoria', { regions })
		expect(outcome).toMatchObject({ ok: false, code: 'ambiguous_region' })
		expect(outcome.ok ? [] : outcome.candidates).toEqual([{ code: 'AU-VIC', name: 'Victoria' }, { code: 'MT-45', name: 'Victoria' }])
		expect(resolveRegion('Victoria', { regions, country: 'AU' })).toEqual({ ok: true, value: 'AU-VIC' })
	})

	it('refuses a code of another country, offering subdivisions of the right one', () => {
		const outcome = resolveRegion('US-ON', { regions, country: 'CA' })
		expect(outcome).toMatchObject({ ok: false, code: 'unknown_region' })
		expect(outcome.ok ? undefined : outcome.candidates[0]).toEqual({ code: 'CA-ON', name: 'Ontario' })
	})

	it('refuses an unknown name with up to five nearest candidates', () => {
		const outcome = resolveRegion('Ontaro', { regions, country: 'CA' })
		expect(outcome).toMatchObject({ ok: false, code: 'unknown_region' })
		if (outcome.ok) return
		expect(outcome.candidates).toHaveLength(5)
		expect(outcome.candidates[0]).toEqual({ code: 'CA-ON', name: 'Ontario' })
	})

	it('fails without the regions provider', () => {
		expect(resolveRegion('CA-ON')).toMatchObject({ ok: false, code: 'missing_format_provider' })
	})
})

describe('display', () => {
	it('prints a subdivision as its short code, full code or name', () => {
		expect(displayRegion('CA-ON', 'code', regions)).toBe('ON')
		expect(displayRegion('CA-ON', 'full', regions)).toBe('CA-ON')
		expect(displayRegion('CA-ON', 'name', regions)).toBe('Ontario')
	})

	it('prints a country name in the requested locale', () => {
		expect(countryName('DE')).toBe('Germany')
		expect(countryName('DE', 'fr-FR')).toBe('Allemagne')
	})
})

describe('an address printed with a country name', () => {
	const address = { line1: '1 Main St', locality: 'Springfield', region: 'IL', postalCode: '62701', country: 'Vereinigte Staaten' }

	it('takes the layout of the layoutCountry code', async () => {
		const { createFormatter } = await import('../src/index')
		expect(createFormatter().formatAddress(address, { layoutCountry: 'US' })).toBe('1 Main St, Springfield, IL 62701, Vereinigte Staaten')
		expect(createFormatter().formatAddress(address, { layout: 'generic' })).toBe('1 Main St, Springfield, IL, 62701, Vereinigte Staaten')
	})

	it('refuses a layoutCountry that is not an alpha-2 code', async () => {
		const { createFormatter } = await import('../src/index')
		expect(createFormatter().safeFormatAddress(address, { layoutCountry: 'USA' })).toMatchObject({ success: false, status: 'invalid' })
	})
})
