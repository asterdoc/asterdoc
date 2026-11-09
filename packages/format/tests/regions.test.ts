import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { findSubdivision, subdivisionsOf } from '../src/index'
import { createFormatter, resolveAddressRegion, resolveRegion } from '../src/index'
import { CLDR_VERSION, aliasTarget, isoSubdivisionCode, regionsProvider as regions } from '../src/regions'

const require = createRequire(import.meta.url)

function packageVersion(name: string): string {
	return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version
}

describe('the CLDR regions provider', () => {
	it('is built from the pinned CLDR release', () => {
		expect(CLDR_VERSION).toBe('49')
		expect(packageVersion('cldr-subdivisions-full')).toBe('49.0.0')
		expect(packageVersion('cldr-core')).toBe('49.0.0')
		expect(regions.source).toEqual({ package: 'cldr-subdivisions-full', version: '49.0.0' })
	})

	it('holds the recorded counts of current subdivisions', () => {
		expect(regions.subdivisions).toHaveLength(5046)
		expect(new Set(regions.subdivisions.map((subdivision) => subdivision.country)).size).toBe(200)
		expect(subdivisionsOf('CA', regions)).toHaveLength(13)
		expect(subdivisionsOf('US', regions)).toHaveLength(57)
	})

	it('converts CLDR ids to ISO 3166-2 codes', () => {
		expect(isoSubdivisionCode('caon')).toBe('CA-ON')
		expect(isoSubdivisionCode('fr971')).toBe('FR-971')
		expect(findSubdivision('CA-ON', regions)).toEqual({ code: 'CA-ON', country: 'CA', name: 'Ontario' })
	})

	it('includes nested subdivisions such as French departments', () => {
		expect(findSubdivision('FR-69', regions)).toMatchObject({ country: 'FR', name: 'Rhône' })
	})

	it('leaves out subdivisions CLDR no longer lists as current', () => {
		expect(findSubdivision('AL-BR', regions)).toBeUndefined()
	})

	it('drops the superscript CLDR uses to tell names apart', () => {
		expect(findSubdivision('FR-IDF', regions)?.name).toBe('Île-de-France')
	})
})

describe('names CLDR keeps under an alias id', () => {
	it('map an alias replaced by a region code to that region under the alias country', () => {
		expect(aliasTarget('cn91', 'HK')).toBe('cnhk')
		expect(aliasTarget('cn15', 'cnmn')).toBe('cnmn')
		expect(aliasTarget('cnxx', 'cnaa cnbb')).toBeUndefined()
	})

	it('name the current subdivisions whose names CLDR files under the old ids', () => {
		expect(findSubdivision('CN-HK', regions)?.name).toBe('Hong Kong SAR China')
		expect(findSubdivision('CN-MO', regions)?.name).toBe('Macao SAR China')
		expect(findSubdivision('CN-TW', regions)?.name).toBe('Taiwan')
		expect(resolveRegion('Taiwan', { country: 'CN', regions })).toEqual({ ok: true, value: 'CN-TW' })
		expect(resolveRegion('Hong Kong SAR China', { country: 'CN', regions })).toEqual({ ok: true, value: 'CN-HK' })
	})
})

describe('an address region in a country without subdivisions', () => {
	it('stays exactly as given, unless it is a full code of another country', () => {
		expect(subdivisionsOf('VA', regions)).toEqual([])
		expect(resolveAddressRegion(' Vatican City ', 'VA', regions)).toEqual({ ok: true, value: ' Vatican City ' })
		expect(resolveAddressRegion('US-CA', 'VA', regions)).toMatchObject({ ok: false, code: 'unknown_region' })
	})
})

describe('the regions provider on a formatter', () => {
	it('is kept by compose and refused when it is not a provider', () => {
		const formatter = createFormatter({ providers: { regions } })
		expect(formatter.providers.regions).toBe(regions)
		expect(formatter.compose({ locale: 'fr-FR' }).providers.regions).toBe(regions)
		expect(() => createFormatter({ providers: { regions: {} as never } })).toThrow('@asterdoc/format/regions')
	})
})
