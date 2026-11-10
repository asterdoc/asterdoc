import { describe, expect, it } from 'vitest'

import { BUILTIN_IMPLS, CHECK_DIGIT_ALGORITHMS, check, createContext, createTypeEnv, evaluateExpression, T, Values, type Value } from '../src/index'

function run(src: string, fields: Record<string, unknown> = {}): Value {
	const result = evaluateExpression(src, createContext({ fields }))
	if (!result.success) throw new Error(`eval failed: ${result.error}`)
	return result.value
}

function valid(value: string, algorithm: string): boolean {
	const result = run('checkDigit(fields.value, fields.algorithm)', { value, algorithm })
	if (result.kind !== 'boolean') throw new Error(`checkDigit returned ${result.kind}`)
	return result.value
}

function failure(src: string, fields: Record<string, unknown> = {}) {
	const result = evaluateExpression(src, createContext({ fields }))
	if (result.success) throw new Error(`expected a failure, got ${result.value.kind}`)
	return result
}

const env = createTypeEnv({
	fields: T.object,
	'fields.value': T.string,
	'fields.algorithm': T.string,
	'fields.amount': T.number,
	'fields.weights': T.array(T.number),
	'fields.labels': T.array(T.string),
})

describe('checkDigit with luhn', () => {
	it('accepts card numbers whose last digit is the Luhn check digit', () => {
		for (const value of ['4111111111111111', '4012888888881881', '378282246310005', '79927398713']) {
			expect(valid(value, 'luhn')).toBe(true)
		}
	})

	it('refuses a changed check digit and a transposed pair', () => {
		expect(valid('4111111111111112', 'luhn')).toBe(false)
		expect(valid('79927398710', 'luhn')).toBe(false)
		expect(valid('79927398731', 'luhn')).toBe(false)
	})

	it('refuses separators, letters, and a value with no payload digit', () => {
		expect(valid('4111 1111 1111 1111', 'luhn')).toBe(false)
		expect(valid('4111-1111-1111-1111', 'luhn')).toBe(false)
		expect(valid('411111111111111A', 'luhn')).toBe(false)
		expect(valid('0', 'luhn')).toBe(false)
		expect(valid('', 'luhn')).toBe(false)
	})

	it('refuses digits outside ASCII', () => {
		expect(valid('٤١١١١١١١١١١١١١١١', 'luhn')).toBe(false)
	})
})

describe('checkDigit with mod97-10', () => {
	it('accepts LEIs, which carry ISO 7064 MOD 97-10 check digits over letters and digits', () => {
		for (const value of ['5493001KJTIIGC8Y1R12', 'HWUPKR0MPOU8FGXBT394', '7LTWFZYICNSX8D621K86']) {
			expect(valid(value, 'mod97-10')).toBe(true)
		}
	})

	it('refuses an LEI with a changed check digit', () => {
		expect(valid('5493001KJTIIGC8Y1R13', 'mod97-10')).toBe(false)
	})

	it('refuses lowercase letters without folding them', () => {
		expect(valid('5493001kjtiigc8y1r12', 'mod97-10')).toBe(false)
		expect(valid('a69', 'mod97-10')).toBe(false)
		expect(valid('0LZ', 'mod97-10')).toBe(false)
		expect(run("checkDigit(upper(fields.value), 'mod97-10')", { value: '5493001kjtiigc8y1r12' })).toEqual(Values.boolean(true))
	})

	it('refuses spaces and punctuation without stripping them', () => {
		expect(valid('5493 001K JTII GC8Y 1R12', 'mod97-10')).toBe(false)
		expect(valid('5493001KJTIIGC8Y1R1!', 'mod97-10')).toBe(false)
		expect(valid('01', 'mod97-10')).toBe(false)
	})

	it('validates an IBAN when the expression moves its first four characters to the end', () => {
		const iban = "checkDigit(substring(fields.value, 4) + substring(fields.value, 0, 4), 'mod97-10')"
		expect(run(iban, { value: 'GB82WEST12345698765432' })).toEqual(Values.boolean(true))
		expect(run(iban, { value: 'DE89370400440532013000' })).toEqual(Values.boolean(true))
		expect(run(iban, { value: 'GB82WEST12345698765431' })).toEqual(Values.boolean(false))
	})

	it('does no rearrangement itself, so an IBAN as written does not pass', () => {
		expect(valid('GB82WEST12345698765432', 'mod97-10')).toBe(false)
	})
})

describe('checkDigit with mod11-2', () => {
	it('accepts ISO 7064 MOD 11-2 values, with X as the check character for ten', () => {
		expect(valid('0000000218250097', 'mod11-2')).toBe(true)
		expect(valid('000000021694233X', 'mod11-2')).toBe(true)
		expect(valid('079X', 'mod11-2')).toBe(true)
	})

	it('refuses a changed check character', () => {
		expect(valid('0000000218250098', 'mod11-2')).toBe(false)
		expect(valid('0000000216942330', 'mod11-2')).toBe(false)
	})

	it('allows X only as the last character, and only uppercase', () => {
		expect(valid('00000002169423X3', 'mod11-2')).toBe(false)
		expect(valid('000000021694233x', 'mod11-2')).toBe(false)
		expect(valid('X', 'mod11-2')).toBe(false)
		expect(valid('X3', 'mod11-2')).toBe(false)
		expect(valid('0000-0002-1825-0097', 'mod11-2')).toBe(false)
	})
})

describe('checkDigit with verhoeff', () => {
	it('accepts values whose last digit is the Verhoeff check digit', () => {
		expect(valid('2363', 'verhoeff')).toBe(true)
		expect(valid('123451', 'verhoeff')).toBe(true)
		expect(valid('1428570', 'verhoeff')).toBe(true)
	})

	it('refuses a changed check digit and a transposed pair', () => {
		expect(valid('2364', 'verhoeff')).toBe(false)
		expect(valid('3263', 'verhoeff')).toBe(false)
		expect(valid('2363X', 'verhoeff')).toBe(false)
	})
})

describe('checkDigit with damm', () => {
	it('accepts values whose last digit is the Damm check digit', () => {
		expect(valid('5724', 'damm')).toBe(true)
		expect(valid('123459', 'damm')).toBe(true)
	})

	it('refuses a changed check digit and a transposed pair', () => {
		expect(valid('5727', 'damm')).toBe(false)
		expect(valid('7524', 'damm')).toBe(false)
		expect(valid('572-4', 'damm')).toBe(false)
	})
})

describe('checkDigit algorithm names and input types', () => {
	it('refuses an unknown algorithm name at design time, naming the allowed ones', () => {
		const diagnostics = check("checkDigit(fields.value, 'mod10')", env).diagnostics
		expect(diagnostics.map((d) => d.code)).toEqual(['type-mismatch'])
		expect(diagnostics[0]!.message).toContain("'luhn', 'mod97-10', 'mod11-2', 'verhoeff', 'damm'")
	})

	it('accepts every known algorithm name at design time and types the result boolean', () => {
		for (const algorithm of CHECK_DIGIT_ALGORITHMS) {
			const result = check(`checkDigit(fields.value, '${algorithm}')`, env)
			expect(result.diagnostics).toEqual([])
			expect(result.type).toEqual(T.boolean)
		}
	})

	it('fails evaluation for an unknown algorithm that reaches it through a value', () => {
		const result = failure('checkDigit(fields.value, fields.algorithm)', { value: '4111111111111111', algorithm: 'LUHN' })
		expect(result.code).toBe('type-error')
		expect(result.error).toBe("checkDigit: argument 2 must be one of 'luhn', 'mod97-10', 'mod11-2', 'verhoeff', 'damm', got \"LUHN\"")
	})

	it('fails a direct call of the implementation with an unknown algorithm', () => {
		expect(() => BUILTIN_IMPLS.checkDigit!([Values.string('4111111111111111'), Values.string('toString')], createContext({}))).toThrow('algorithm')
	})

	it('refuses a number where the value string belongs, at design time and at evaluation', () => {
		expect(check("checkDigit(fields.amount, 'luhn')", env).diagnostics.map((d) => d.code)).toEqual(['type-mismatch'])
		expect(failure("checkDigit(fields.amount, 'luhn')", { amount: 4111111111111111 }).code).toBe('type-error')
	})

	it('reports an unanswered value as missing, not failed', () => {
		const result = failure("checkDigit(fields.value, 'luhn')", {})
		expect(result.code).toBe('missing-input')
		expect(result.missing).toEqual(['fields.value'])
	})
})

describe('weightedMod', () => {
	const aba = 'weightedMod(fields.value, [3, 7, 1], 10) == 0'

	it('expresses the ABA routing number check', () => {
		expect(run(aba, { value: '021000021' })).toEqual(Values.boolean(true))
		expect(run(aba, { value: '011000015' })).toEqual(Values.boolean(true))
		expect(run(aba, { value: '123456789' })).toEqual(Values.boolean(false))
	})

	it('returns the weighted sum modulo the modulus, repeating weights from the left', () => {
		expect(run('weightedMod(fields.value, [3, 7, 1], 10)', { value: '123456789' })).toEqual(Values.num('9'))
		expect(run('weightedMod(fields.value, [1, 2, 3, 4, 5], 7)', { value: '12' })).toEqual(Values.num('5'))
		expect(run('weightedMod(fields.value, [2], 1000)', { value: '999' })).toEqual(Values.num('54'))
	})

	it('keeps the result non-negative with negative weights', () => {
		expect(run('weightedMod(fields.value, [-1], 10)', { value: '3' })).toEqual(Values.num('7'))
	})

	it('returns null for any non-digit or an empty value, so the ABA check is false', () => {
		for (const value of ['02100002A', '021-000-021', ' 021000021', '', '٠٢١٠٠٠٠٢١']) {
			expect(run('weightedMod(fields.value, [3, 7, 1], 10)', { value })).toEqual(Values.null)
			expect(run(aba, { value })).toEqual(Values.boolean(false))
		}
	})

	it('types the result as a number and the weights as numbers at design time', () => {
		expect(check('weightedMod(fields.value, [3, 7, 1], 10)', env).type).toEqual(T.number)
		expect(check('weightedMod(fields.value, fields.weights, 10) == 0', env).diagnostics).toEqual([])
		expect(check("weightedMod(fields.value, ['3', '7'], 10)", env).diagnostics.map((d) => d.code)).toEqual(['type-mismatch'])
		expect(check('weightedMod(fields.value, 3, 10)', env).diagnostics.map((d) => d.code)).toEqual(['type-mismatch'])
	})

	it('fails for weights or a modulus that are not whole numbers, or no weights at all', () => {
		expect(failure('weightedMod(fields.value, [1.5], 10)', { value: '12' }).error).toContain('whole number')
		expect(failure('weightedMod(fields.value, [1], 2.5)', { value: '12' }).error).toContain('whole number')
		expect(failure('weightedMod(fields.value, [1], 0)', { value: '12' }).error).toContain('positive')
		expect(failure('weightedMod(fields.value, fields.weights, 10)', { value: '12', weights: [] }).error).toContain('at least one weight')
	})

	it('refuses a number where the digit string belongs', () => {
		expect(failure('weightedMod(fields.value, [3, 7, 1], 10)', { value: 21000021 }).code).toBe('type-error')
	})
})

describe('substring', () => {
	const text = (src: string, value: string) => {
		const result = run(src, { value })
		if (result.kind !== 'string') throw new Error(`expected a string, got ${result.kind}`)
		return result.value
	}

	it('takes start inclusive and end exclusive, to the end without one', () => {
		expect(text('substring(fields.value, 0, 4)', 'GB82WEST')).toBe('GB82')
		expect(text('substring(fields.value, 4)', 'GB82WEST')).toBe('WEST')
		expect(text('substring(fields.value, 0, length(fields.value))', 'GB82WEST')).toBe('GB82WEST')
	})

	it('clamps negative and out-of-range indexes, and swaps a start after the end', () => {
		expect(text('substring(fields.value, -3, 2)', 'abcdef')).toBe('ab')
		expect(text('substring(fields.value, 2, 100)', 'abcdef')).toBe('cdef')
		expect(text('substring(fields.value, 10)', 'abcdef')).toBe('')
		expect(text('substring(fields.value, 4, 1)', 'abcdef')).toBe('bcd')
		expect(text('substring(fields.value, 0, 1000000000000000000000)', 'abc')).toBe('abc')
	})

	it('returns an empty string from an empty string', () => {
		expect(text('substring(fields.value, 0, 3)', '')).toBe('')
	})

	it('counts UTF-16 code units, so it can split a surrogate pair', () => {
		expect(text('substring(fields.value, 0, 1)', '😀a')).toBe('\uD83D')
		expect(text('substring(fields.value, 2)', '😀a')).toBe('a')
		expect(run('length(fields.value)', { value: '😀a' })).toEqual(Values.num('3'))
	})

	it('fails for an index that is not a whole number', () => {
		expect(failure('substring(fields.value, 1.5)', { value: 'abc' }).error).toContain('whole number')
	})

	it('types arguments and result at design time', () => {
		expect(check('substring(fields.value, 0, 2)', env).type).toEqual(T.string)
		expect(check("substring(fields.value, '0')", env).diagnostics.map((d) => d.code)).toEqual(['type-mismatch'])
		expect(check('substring(fields.value)', env).diagnostics.map((d) => d.code)).toEqual(['arity'])
	})
})

describe('charAt', () => {
	it('returns the code unit at an index, or an empty string out of range', () => {
		expect(run('charAt(fields.value, 0)', { value: 'abc' })).toEqual(Values.string('a'))
		expect(run('charAt(fields.value, 2)', { value: 'abc' })).toEqual(Values.string('c'))
		expect(run('charAt(fields.value, 3)', { value: 'abc' })).toEqual(Values.string(''))
		expect(run('charAt(fields.value, -1)', { value: 'abc' })).toEqual(Values.string(''))
		expect(run('charAt(fields.value, 0)', { value: '' })).toEqual(Values.string(''))
	})

	it('returns half of a surrogate pair at its index', () => {
		expect(run('charAt(fields.value, 1)', { value: '😀' })).toEqual(Values.string('\uDE00'))
	})

	it('fails for an index that is not a whole number', () => {
		expect(failure('charAt(fields.value, 0.5)', { value: 'abc' }).error).toContain('whole number')
	})

	it('types the result as a string at design time and refuses a string index', () => {
		expect(check('charAt(fields.value, 0) == "a"', env).diagnostics).toEqual([])
		expect(check("charAt(fields.value, 'a')", env).diagnostics.map((d) => d.code)).toEqual(['type-mismatch'])
	})
})

describe('split', () => {
	it('splits on every separator and keeps empty pieces', () => {
		expect(run("split(fields.value, '-')", { value: '123-45-6789' })).toEqual(Values.array(['123', '45', '6789'].map(Values.string)))
		expect(run("split(fields.value, ',')", { value: 'a,,b,' })).toEqual(Values.array(['a', '', 'b', ''].map(Values.string)))
	})

	it('returns one piece for a value without the separator, including the empty string', () => {
		expect(run("split(fields.value, '-')", { value: 'abc' })).toEqual(Values.array([Values.string('abc')]))
		expect(run("split(fields.value, '-')", { value: '' })).toEqual(Values.array([Values.string('')]))
	})

	it('splits into UTF-16 code units with an empty separator', () => {
		expect(run("split(fields.value, '')", { value: 'a😀' })).toEqual(Values.array(['a', '\uD83D', '\uDE00'].map(Values.string)))
	})

	it('yields a list that indexing, length, and in read', () => {
		expect(run("length(split(fields.value, '-')) == 3 and split(fields.value, '-')[1] == '45'", { value: '123-45-6789' })).toEqual(Values.boolean(true))
		expect(run("'45' in split(fields.value, '-')", { value: '123-45-6789' })).toEqual(Values.boolean(true))
	})

	it('types the result as array<string> at design time', () => {
		expect(check("split(fields.value, '-')", env).type).toEqual(T.array(T.string))
		expect(check("split(fields.value, '-') == fields.labels", env).diagnostics).toEqual([])
		expect(check('split(fields.value, 1)', env).diagnostics.map((d) => d.code)).toEqual(['type-mismatch'])
	})
})
