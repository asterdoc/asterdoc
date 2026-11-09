import { describe, expect, it } from 'vitest'
import {
	FormatConfigurationError,
	MASK_MISMATCH,
	canonicalizeMasked,
	describeMask,
	formatMasked,
	isValidMask,
	maskGroup,
	parseMask,
} from '../src/index'

const read = (mask: string, input: string, options?: Parameters<typeof canonicalizeMasked>[2]) => {
	const result = canonicalizeMasked(mask, input, options)
	return result.success ? result.value : result.code
}

describe('reading a masked value', () => {
	it('gives the same canonical value for canonical and formatted input', () => {
		expect(read('###-##-####', '123456789')).toBe('123456789')
		expect(read('###-##-####', '123-45-6789')).toBe('123456789')
		expect(read('##-#######', '12-3456789')).toBe('123456789')
		expect(read('A-#########', 'A-123456789')).toBe('123456789')
		expect(read('A-#########', '123456789')).toBe('123456789')
	})

	it('reads by position, never by stripping literals', () => {
		expect(read('###-##-####', '12-345-6789')).toBe(MASK_MISMATCH)
		expect(read('###-##-####', '123 45 6789')).toBe(MASK_MISMATCH)
		expect(read('###-##-####', '1234-56789')).toBe(MASK_MISMATCH)
	})

	it('takes the formatted reading when both forms match, and returns a canonical value unchanged', () => {
		expect(read('A-@@', 'AB')).toBe('AB')
		expect(read('A-@@', 'A-AB')).toBe('AB')
		expect(read('A-@@', read('A-@@', 'A-AB'))).toBe('AB')
		expect(read('##', '12')).toBe('12')
	})

	it('refuses a wrong character and a wrong length, naming the expected shape', () => {
		const wrong = canonicalizeMasked('###-##-####', '12345678X')
		expect(wrong).toEqual({ success: false, code: MASK_MISMATCH, message: expect.stringContaining('Expected ###-##-####: 9 digits, written 123-45-6789 or 123456789') })
		expect(read('###-##-####', '12345678')).toBe(MASK_MISMATCH)
		expect(read('###-##-####', '1234567890')).toBe(MASK_MISMATCH)
		expect(read('@@', '1A')).toBe(MASK_MISMATCH)
		expect(read('**', 'é1')).toBe(MASK_MISMATCH)
	})

	it('reads an escaped token as a literal', () => {
		expect(read('\\#-###', '#-123')).toBe('123')
		expect(read('\\#-###', '123')).toBe('123')
		expect(read('\\#-###', '1-123')).toBe(MASK_MISMATCH)
		expect(parseMask('\\#-###').tokenCount).toBe(3)
	})
})

describe('mask A-@@, whose literal A is also a letter', () => {
	it('reads complete input by the both-match rule, in every mode and input form', () => {
		for (const options of [{}, { mode: 'progressive' as const }, { mode: 'progressive' as const, input: 'formatted' as const }]) {
			expect(read('A-@@', 'AB', options)).toBe('AB')
			expect(read('A-@@', 'A-AB', options)).toBe('AB')
		}
	})

	it('refuses the prefixes A and A- in complete mode', () => {
		expect(read('A-@@', 'A')).toBe(MASK_MISMATCH)
		expect(read('A-@@', 'A-')).toBe(MASK_MISMATCH)
	})

	it('reads a canonical prefix as token characters', () => {
		const canonical = { mode: 'progressive' as const, input: 'canonical' as const }
		expect(canonicalizeMasked('A-@@', 'A', canonical)).toEqual({ success: true, value: 'A', complete: false })
		expect(read('A-@@', 'A-', canonical)).toBe(MASK_MISMATCH)
		expect(read('A-@@', 'A', { mode: 'progressive' })).toBe('A')
	})

	it('reads a formatted prefix with the literals in place', () => {
		const formatted = { mode: 'progressive' as const, input: 'formatted' as const }
		expect(canonicalizeMasked('A-@@', 'A', formatted)).toEqual({ success: true, value: '', complete: false })
		expect(read('A-@@', 'A-', formatted)).toBe('')
		expect(read('A-@@', 'A-A', formatted)).toBe('A')
		expect(read('A-@@', 'B', formatted)).toBe(MASK_MISMATCH)
	})

	it('returns a stored canonical prefix unchanged when it is written again', () => {
		const canonical = { mode: 'progressive' as const }
		expect(read('A-@@', read('A-@@', 'A', canonical), canonical)).toBe('A')
		expect(read('###-##-####', read('###-##-####', '1234', canonical), canonical)).toBe('1234')
	})
})

describe('printing a masked value', () => {
	it('puts the literals back, and takes the Nth group', () => {
		expect(formatMasked('###-##-####', '123456789')).toEqual({ success: true, value: '123-45-6789', complete: true })
		expect(formatMasked('A-#########', '123456789')).toMatchObject({ value: 'A-123456789' })
		expect(formatMasked('\\#-###', '123')).toMatchObject({ value: '#-123' })
		expect(maskGroup('###-##-####', '123456789', 1)).toMatchObject({ value: '45' })
		expect(maskGroup('###-##-####', '123456789', 2)).toMatchObject({ value: '6789' })
		expect(parseMask('A-#########').groups).toEqual([9])
	})

	it('refuses a value that does not fit, and a group the mask lacks', () => {
		expect(formatMasked('###-##-####', '12345')).toMatchObject({ success: false, code: MASK_MISMATCH })
		expect(formatMasked('###-##-####', '123-45-6789')).toMatchObject({ success: false, code: MASK_MISMATCH })
		expect(maskGroup('###-##-####', '123456789', 3)).toMatchObject({ success: false, code: MASK_MISMATCH })
		expect(maskGroup('###-##-####', '12345', 0)).toMatchObject({ success: false, code: MASK_MISMATCH })
	})
})

describe('the mask itself', () => {
	it('refuses a mask without a token, with a trailing escape, or outside ASCII', () => {
		expect(() => parseMask('A-B')).toThrow(FormatConfigurationError)
		expect(() => parseMask('##\\')).toThrow(FormatConfigurationError)
		expect(() => parseMask('##é')).toThrow(FormatConfigurationError)
		expect(() => parseMask('\\#')).toThrow(FormatConfigurationError)
		expect(isValidMask('###-##-####')).toBe(true)
		expect(isValidMask('')).toBe(false)
	})

	it('describes letters, digits and mixed positions', () => {
		expect(describeMask('@@')).toBe('@@: 2 letters, written AB')
		expect(describeMask('**-#')).toBe('**-#: 3 digits or letters, written 12-3 or 123')
		expect(describeMask('@#')).toBe('@#: 2 digits and letters at fixed positions, written A1')
	})
})
