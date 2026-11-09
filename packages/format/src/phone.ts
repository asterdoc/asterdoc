import {
	Metadata,
	getCountryCallingCode,
	isSupportedCountry,
	parsePhoneNumberWithError,
	type CountryCode,
	type PhoneNumber,
} from 'libphonenumber-js/min'
import type { PhoneNumberDetails, PhoneProvider, ProvidedPhoneStyle } from '@asterdoc/types'

export type { PhoneNumberDetails, PhoneProvider, ProvidedPhoneStyle } from '@asterdoc/types'

const E164_MAX_DIGITS = 15

function supportedRegion(region: string): region is CountryCode {
	return /^[A-Z]{2}$/.test(region) && isSupportedCountry(region)
}

function read(text: string, region?: CountryCode): PhoneNumber | undefined {
	try {
		return parsePhoneNumberWithError(text, { ...(region && { defaultCountry: region }), extract: false })
	} catch {
		return undefined
	}
}

function details(parsed: PhoneNumber): PhoneNumberDetails {
	return {
		number: parsed.number,
		countryCallingCode: parsed.countryCallingCode,
		nationalNumber: parsed.nationalNumber,
		...(parsed.country !== undefined && { region: parsed.country }),
		international: parsed.formatInternational(),
		national: parsed.formatNational(),
	}
}

function parse(text: string, region?: string): PhoneNumberDetails | undefined {
	if (typeof text !== 'string') return undefined
	if (region !== undefined && !supportedRegion(region)) return undefined
	const parsed = read(text, region)
	if (!parsed || parsed.ext !== undefined || !parsed.isValid()) return undefined
	return details(parsed)
}

function callingCode(region: string): string | undefined {
	return supportedRegion(region) ? getCountryCallingCode(region) : undefined
}

type Shapes = Readonly<Record<ProvidedPhoneStyle, string>>

const metadata = new Metadata()
const regionShapes = new Map<string, Shapes>()
const ANY_REGION: Shapes = Object.freeze({
	international: '+0 0000 0000 000 000',
	national: '0 (0000) 0000 000 000',
	digits: '00000000000000',
})

function digitCount(text: string): number {
	return text.replace(/\D/g, '').length
}

function longer(current: string, candidate: string): string {
	const digits = digitCount(candidate) - digitCount(current)
	return digits > 0 || (digits === 0 && candidate.length > current.length) ? candidate : current
}

function shapesFor(region: CountryCode): Shapes {
	const cached = regionShapes.get(region)
	if (cached) return cached
	const code = getCountryCallingCode(region)
	metadata.selectNumberingPlan(region)
	const lengths = metadata.numberingPlan?.possibleLengths() ?? []
	let international = ''
	let national = ''
	let digits = ''
	for (const length of lengths) {
		const capped = Math.min(length, E164_MAX_DIGITS - code.length)
		for (let prefix = 0; prefix < 100; prefix++) {
			const nationalNumber = `${String(prefix).padStart(2, '0')}${'5'.repeat(capped)}`.slice(0, capped)
			const parsed = read(`+${code}${nationalNumber}`)
			if (!parsed) continue
			international = longer(international, parsed.formatInternational())
			national = longer(national, parsed.formatNational())
			digits = longer(digits, parsed.nationalNumber)
		}
	}
	const shapes = {
		international: international.replace(/\d/g, '0'),
		national: national.replace(/\d/g, '0'),
		digits: digits.replace(/\d/g, '0'),
	}
	regionShapes.set(region, shapes)
	return shapes
}

function longest(style: ProvidedPhoneStyle, region?: string): string {
	if (region !== undefined && !supportedRegion(region)) return ''
	return (region === undefined ? ANY_REGION : shapesFor(region))[style]
}

/**
 * Phone numbering plans for a formatter's `providers.phone`, from
 * `libphonenumber-js` with its minimal metadata. Parsing is strict: the text
 * must be the number alone, valid in its plan.
 *
 * @example
 * ```ts
 * import { createFormatter } from '@asterdoc/format'
 * import { phoneProvider } from '@asterdoc/format/phone'
 *
 * const formatter = createFormatter({ providers: { phone: phoneProvider } })
 * formatter.formatPhone('+12125551234', { style: 'national' }) // '(212) 555-1234'
 * ```
 */
export const phoneProvider: PhoneProvider = Object.freeze({ parse, callingCode, longest })
