import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min'
import { describe, expect, it } from 'vitest'

import {
	INVALID_PHONE,
	MISSING_FORMAT_PROVIDER,
	PHONE_PROVIDER_ENTRY_POINT,
	PHONE_REGION_MISMATCH,
	createFormatter,
	defaultFormatter,
} from '../src/index'
import { phoneProvider } from '../src/phone'

const formatter = createFormatter({ providers: { phone: phoneProvider } })

const US = '+12125551234'
const UK = '+442079460958'
const SINGAPORE = '+6565123456'

describe('phone styles', () => {
	it.each([
		['e164', US, '+12125551234'],
		['international', US, '+1 212 555 1234'],
		['national', US, '(212) 555-1234'],
		['digits', US, '2125551234'],
		['e164', UK, '+442079460958'],
		['international', UK, '+44 20 7946 0958'],
		['national', UK, '020 7946 0958'],
		['digits', UK, '2079460958'],
		['international', SINGAPORE, '+65 6512 3456'],
		['national', SINGAPORE, '6512 3456'],
		['digits', SINGAPORE, '65123456'],
	] as const)('prints %s for %s', (style, number, expected) => {
		expect(formatter.formatPhone(number, { style })).toBe(expected)
	})

	it('prints the extension after the styled number, as with e164', () => {
		expect(formatter.formatPhone({ number: UK, extension: '42' }, { style: 'national' })).toBe('020 7946 0958 ext. 42')
		expect(formatter.formatPhone({ number: UK, extension: '42' }, { style: 'digits', extensionLabel: 'x' })).toBe('2079460958 x 42')
	})

	it('prints the stored number with no style, as before', () => {
		expect(formatter.formatPhone({ number: UK, extension: '42' })).toBe('+442079460958 ext. 42')
		expect(defaultFormatter.formatPhone(US)).toBe(US)
	})

	it('refuses a number no numbering plan accepts once a style other than e164 is set', () => {
		const result = formatter.safeFormatPhone('+15555555555', { style: 'national' })
		expect(result).toMatchObject({ success: false, status: 'invalid', issues: [{ code: INVALID_PHONE, path: 'number' }] })
		expect(formatter.formatPhone('+15555555555', { style: 'e164' })).toBe('+15555555555')
	})

	it('refuses a national or digits number of another calling code than phone.region names', () => {
		for (const style of ['national', 'digits'] as const) {
			const result = formatter.safeFormatPhone(UK, { style, region: 'US' })
			expect(result).toMatchObject({ success: false, status: 'invalid', issues: [{ code: PHONE_REGION_MISMATCH }] })
		}
	})

	it('accepts a number of another region that shares the calling code, since no digit is lost', () => {
		expect(formatter.formatPhone('+14165550123', { style: 'digits', region: 'US' })).toBe('4165550123')
	})

	it('lets an international number of another region through, since it prints its calling code', () => {
		expect(formatter.formatPhone(UK, { style: 'international', region: 'US' })).toBe('+44 20 7946 0958')
	})

	it('refuses a region the phone data does not know, and a style it does not know', () => {
		expect(formatter.safeFormatPhone(US, { style: 'national', region: 'XX' })).toMatchObject({ success: false, issues: [{ code: 'invalid_options' }] })
		expect(formatter.safeFormatPhone(US, { style: 'local' as never })).toMatchObject({ success: false, issues: [{ code: 'invalid_options' }] })
		expect(formatter.safeFormatPhone(US, { region: 'us' })).toMatchObject({ success: false, issues: [{ code: 'invalid_options' }] })
	})
})

describe('the phone provider', () => {
	it('fails with missing_format_provider, naming its entry point, when a style needs it and the formatter lacks it', () => {
		for (const style of ['international', 'national', 'digits'] as const) {
			const result = defaultFormatter.safeFormatPhone(US, { style })
			expect(result).toMatchObject({ success: false, status: 'unsupported', issues: [{ code: MISSING_FORMAT_PROVIDER }] })
			expect(result.success ? '' : result.issues[0]!.message).toContain(PHONE_PROVIDER_ENTRY_POINT)
		}
		expect(defaultFormatter.formatPhone(US, { style: 'e164' })).toBe(US)
	})

	it('survives compose, and compose can add it', () => {
		expect(formatter.compose({ locale: 'fr-FR' }).formatPhone(US, { style: 'national' })).toBe('(212) 555-1234')
		expect(defaultFormatter.compose({ providers: { phone: phoneProvider } }).formatPhone(US, { style: 'digits' })).toBe('2125551234')
		expect(formatter.providers.phone).toBe(phoneProvider)
		expect(defaultFormatter.providers.phone).toBeUndefined()
	})

	it('refuses a provider that does not implement the phone provider', () => {
		expect(() => createFormatter({ providers: { phone: { parse: () => undefined } as never } })).toThrow(PHONE_PROVIDER_ENTRY_POINT)
	})

	it('parses E.164, international, and national text with a region, and reads its parts', () => {
		expect(phoneProvider.parse(US)).toEqual({
			number: US,
			countryCallingCode: '1',
			nationalNumber: '2125551234',
			region: 'US',
			international: '+1 212 555 1234',
			national: '(212) 555-1234',
		})
		expect(phoneProvider.parse('+44 20 7946 0958')?.number).toBe(UK)
		expect(phoneProvider.parse('020 7946 0958', 'GB')?.number).toBe(UK)
		expect(phoneProvider.parse('2079460958', 'GB')?.number).toBe(UK)
		expect(phoneProvider.parse('+14165550123')?.region).toBe('CA')
	})

	it('refuses text that is not a valid number alone', () => {
		expect(phoneProvider.parse('call +12125551234 now')).toBeUndefined()
		expect(phoneProvider.parse('(212) 555-1234')).toBeUndefined()
		expect(phoneProvider.parse('+12125551234 ext. 5')).toBeUndefined()
		expect(phoneProvider.parse('2125551234', 'XX')).toBeUndefined()
		expect(phoneProvider.parse('+15555555555')).toBeUndefined()
	})

	it('names the calling code of a known region only', () => {
		expect(phoneProvider.callingCode('GB')).toBe('44')
		expect(phoneProvider.callingCode('XX')).toBeUndefined()
		expect(phoneProvider.callingCode('gb')).toBeUndefined()
	})

	it('gives the longest text of each style in a plan, every digit written 0', () => {
		expect(phoneProvider.longest('national', 'US')).toBe('(000) 000-0000')
		expect(phoneProvider.longest('international', 'US')).toBe('+0 000 000 0000')
		expect(phoneProvider.longest('digits', 'US')).toBe('0000000000')
		expect(phoneProvider.longest('national', 'XX')).toBe('')
	})

	it('keeps the any-plan longest texts equal to the longest of every plan, most digits first, within E.164', () => {
		const longest = { international: '', national: '', digits: '' }
		for (const region of getCountries()) {
			for (const style of ['international', 'national', 'digits'] as const) {
				const shape = phoneProvider.longest(style, region)
				const digits = (text: string) => text.replace(/\D/g, '').length
				const more = digits(shape) - digits(longest[style])
				if (more > 0 || (more === 0 && shape.length > longest[style].length)) longest[style] = shape
			}
			expect(phoneProvider.longest('digits', region).length).toBeLessThanOrEqual(15 - getCountryCallingCode(region).length)
		}
		const size = (text: string) => ({ digits: text.replace(/\D/g, '').length, length: text.length })
		for (const style of ['international', 'national', 'digits'] as const) {
			expect(size(phoneProvider.longest(style))).toEqual(size(longest[style]))
		}
	}, 20_000)
})
