import { describe, expect, test } from 'vitest'
import { canonicalJson } from '@/integrity/canonical-json'

const ieee754 = (hex: string): number => new DataView(Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer).getFloat64(0)

describe('canonical JSON follows RFC 8785', () => {
	test.each([
		['0000000000000000', '0'],
		['8000000000000000', '0'],
		['0000000000000001', '5e-324'],
		['8000000000000001', '-5e-324'],
		['7fefffffffffffff', '1.7976931348623157e+308'],
		['ffefffffffffffff', '-1.7976931348623157e+308'],
		['4340000000000000', '9007199254740992'],
		['c340000000000000', '-9007199254740992'],
		['4430000000000000', '295147905179352830000'],
		['44b52d02c7e14af5', '9.999999999999997e+22'],
		['44b52d02c7e14af6', '1e+23'],
		['44b52d02c7e14af7', '1.0000000000000001e+23'],
		['444b1ae4d6e2ef4e', '999999999999999700000'],
		['444b1ae4d6e2ef4f', '999999999999999900000'],
		['444b1ae4d6e2ef50', '1e+21'],
		['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
		['3eb0c6f7a0b5ed8d', '0.000001'],
		['41b3de4355555553', '333333333.3333332'],
		['41b3de4355555554', '333333333.33333325'],
		['41b3de4355555555', '333333333.3333333'],
		['41b3de4355555556', '333333333.3333334'],
		['41b3de4355555557', '333333333.33333343'],
		['becbf647612f3696', '-0.0000033333333333333333'],
		['43143ff3c1cb0959', '1424953923781206.2'],
	])('writes the IEEE 754 value %s as %s (Appendix B)', (hex, expected) => {
		expect(canonicalJson(ieee754(hex))).toBe(expected)
	})

	test.each([['7fffffffffffffff'], ['7ff0000000000000'], ['fff0000000000000']])(
		'refuses the IEEE 754 value %s, which has no JSON form (Appendix B)',
		(hex) => {
			expect(() => canonicalJson({ value: ieee754(hex) })).toThrow(/\$\.value: .* has no JSON form/)
		},
	)

	test('writes the section 3.2.2 sample as the section 3.2.3 output, byte for byte (section 3.2.4)', () => {
		const input = JSON.parse(
			'{\n  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],\n' +
				'  "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",\n' +
				'  "literals": [null, true, false]\n}',
		)
		const output = canonicalJson(input)
		expect(output).toBe(
			'{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
		)
		const bytes = Array.from(new TextEncoder().encode(output), (byte) => byte.toString(16).padStart(2, '0')).join(' ')
		expect(bytes).toBe(
			'7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72 ' +
				'75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a ' +
				'5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31 ' +
				'65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37 ' +
				'5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30 ' +
				'30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d',
		)
	})

	test('sorts property names by their UTF-16 code units (section 3.2.3)', () => {
		const input = JSON.parse(
			'{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One",' +
				'"\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
		)
		expect(canonicalJson(input)).toBe(
			'{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis",' +
				'"\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
		)
	})

	test('sorts nested objects and keeps array order', () => {
		expect(canonicalJson({ b: [3, { z: 1, a: 2 }, 1], a: { y: null, x: 'x' } })).toBe('{"a":{"x":"x","y":null},"b":[3,{"a":2,"z":1},1]}')
	})

	test('writes equal JSON data the same way whatever its key order or number spelling', () => {
		expect(canonicalJson(JSON.parse('{"a": 1.50, "b": [1e2]}'))).toBe(canonicalJson(JSON.parse('{"b":[100],"a":1.5}')))
	})

	test('leaves out an undefined member and writes an undefined element as null, as JSON.stringify does', () => {
		expect(canonicalJson({ a: undefined, b: [undefined] })).toBe('{"b":[null]}')
	})

	test('writes a hole in a sparse array as null', () => {
		const sparse: number[] = []
		sparse[0] = 1
		sparse[2] = 3
		expect(1 in sparse).toBe(false)
		expect(canonicalJson(sparse)).toBe('[1,null,3]')
		expect(canonicalJson(new Array(2))).toBe('[null,null]')
	})

	test('refuses a lone surrogate in a string or a property name', () => {
		expect(() => canonicalJson({ text: 'a\ud800b' })).toThrow(/\$\.text: .*lone surrogate \(U\+D800\)/)
		expect(() => canonicalJson({ ['\udc00']: 1 })).toThrow(/lone surrogate \(U\+DC00\)/)
	})

	test('refuses values with no JSON form', () => {
		expect(() => canonicalJson({ when: new Date(0) })).toThrow(/\$\.when: a Date object has no JSON form/)
		expect(() => canonicalJson({ big: 1n })).toThrow(/\$\.big: a bigint has no JSON form/)
		expect(() => canonicalJson({ run: () => 1 })).toThrow(/\$\.run: a function has no JSON form/)
	})
})
