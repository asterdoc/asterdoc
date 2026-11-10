/** The check-digit algorithms `checkDigit` accepts, by name. */
export const CHECK_DIGIT_ALGORITHMS = ['luhn', 'mod97-10', 'mod11-2', 'verhoeff', 'damm'] as const

/** One of {@link CHECK_DIGIT_ALGORITHMS}. */
export type CheckDigitAlgorithm = (typeof CHECK_DIGIT_ALGORITHMS)[number]

const DIGITS = /^\d{2,}$/
const MOD11_2 = /^\d+[\dX]$/
const MOD97_10 = /^[\dA-Z]+\d{2}$/

const VERHOEFF_MULTIPLY: readonly (readonly number[])[] = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
	[2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
	[3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
	[4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
	[5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
	[6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
	[7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
	[8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
	[9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

const VERHOEFF_PERMUTE: readonly (readonly number[])[] = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
	[5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
	[8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
	[9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
	[4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
	[2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
	[7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

const DAMM: readonly (readonly number[])[] = [
	[0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
	[7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
	[4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
	[1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
	[6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
	[3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
	[5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
	[8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
	[9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
	[2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
]

function digitAt(value: string, index: number): number {
	return value.charCodeAt(index) - 48
}

function luhn(value: string): boolean {
	if (!DIGITS.test(value)) return false
	let sum = 0
	for (let i = value.length - 1, double = false; i >= 0; i--, double = !double) {
		const digit = digitAt(value, i)
		const term = double ? digit * 2 : digit
		sum += term > 9 ? term - 9 : term
	}
	return sum % 10 === 0
}

function mod97_10(value: string): boolean {
	if (!MOD97_10.test(value)) return false
	let remainder = 0
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i)
		remainder = code <= 57 ? (remainder * 10 + code - 48) % 97 : (remainder * 100 + code - 55) % 97
	}
	return remainder === 1
}

function mod11_2(value: string): boolean {
	if (!MOD11_2.test(value)) return false
	let remainder = 0
	for (let i = 0; i < value.length; i++) {
		const character = value.charCodeAt(i) === 88 ? 10 : digitAt(value, i)
		remainder = (remainder * 2 + character) % 11
	}
	return remainder === 1
}

function verhoeff(value: string): boolean {
	if (!DIGITS.test(value)) return false
	let check = 0
	for (let position = 0; position < value.length; position++) {
		const digit = digitAt(value, value.length - 1 - position)
		check = VERHOEFF_MULTIPLY[check]![VERHOEFF_PERMUTE[position % 8]![digit]!]!
	}
	return check === 0
}

function damm(value: string): boolean {
	if (!DIGITS.test(value)) return false
	let interim = 0
	for (let i = 0; i < value.length; i++) interim = DAMM[interim]![digitAt(value, i)]!
	return interim === 0
}

const VALIDATORS: Readonly<Record<CheckDigitAlgorithm, (value: string) => boolean>> = {
	luhn,
	'mod97-10': mod97_10,
	'mod11-2': mod11_2,
	verhoeff,
	damm,
}

/** Whether `algorithm` names one of {@link CHECK_DIGIT_ALGORITHMS}. */
export function isCheckDigitAlgorithm(algorithm: string): algorithm is CheckDigitAlgorithm {
	return (CHECK_DIGIT_ALGORITHMS as readonly string[]).includes(algorithm)
}

/**
 * Whether `value`, check characters included, passes `algorithm`. A value with
 * a character the algorithm does not allow, or with no characters besides its
 * check characters, does not pass.
 */
export function validCheckDigits(value: string, algorithm: CheckDigitAlgorithm): boolean {
	return VALIDATORS[algorithm](value)
}

/**
 * The sum of each digit of `value` times its weight, modulo `modulus`, with
 * weights applied from the leftmost digit and repeated when shorter than the
 * value. Undefined when `value` is empty or holds a character other than an
 * ASCII digit.
 */
export function weightedDigitSum(value: string, weights: readonly bigint[], modulus: bigint): bigint | undefined {
	if (!/^\d+$/.test(value)) return undefined
	let sum = 0n
	for (let i = 0; i < value.length; i++) sum += BigInt(digitAt(value, i)) * weights[i % weights.length]!
	return ((sum % modulus) + modulus) % modulus
}
