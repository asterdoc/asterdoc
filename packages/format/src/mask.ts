import { FormatConfigurationError } from './errors'

/** The outcome code for a value that does not fit its mask. */
export const MASK_MISMATCH = 'mask_mismatch'

/** A mask token: `#` a digit, `@` an ASCII letter, `*` a digit or an ASCII letter. */
export type MaskToken = '#' | '@' | '*'

/** One position of a mask: a token a value character fills, or a literal the mask prints. */
export type MaskSlot =
	| { readonly kind: 'token'; readonly token: MaskToken }
	| { readonly kind: 'literal'; readonly char: string }

/** A mask read into its positions. */
export interface ParsedMask {
	/** The mask as written. */
	readonly source: string
	/** Every position, in order. */
	readonly slots: readonly MaskSlot[]
	/** How many characters a complete canonical value has. */
	readonly tokenCount: number
	/** The token count of each group: a run of tokens between literals. */
	readonly groups: readonly number[]
}

/**
 * The form a value is written in: `canonical` holds only the token characters,
 * `formatted` holds the mask's literals at their positions too.
 */
export type MaskInputForm = 'canonical' | 'formatted'

/**
 * `complete` refuses a value that does not fill the mask; `progressive`
 * accepts a prefix written in the stated input form.
 */
export type MaskMode = 'progressive' | 'complete'

/** Options for {@link canonicalizeMasked}. */
export interface MaskCanonicalizeOptions {
	/** Default `complete`. */
	mode?: MaskMode
	/**
	 * How a partial value is written, for `progressive` mode. Default
	 * `canonical`. A complete value is read in either form regardless.
	 */
	input?: MaskInputForm
}

/** A value read or printed through a mask, or why it does not fit. */
export type MaskResult =
	| { readonly success: true; readonly value: string; readonly complete: boolean }
	| { readonly success: false; readonly code: typeof MASK_MISMATCH; readonly message: string }

const TOKENS: Readonly<Record<string, MaskToken>> = { '#': '#', '@': '@', '*': '*' }

/** Whether a character may fill a token position. Only ASCII digits and letters fit. */
export function fitsMaskToken(token: MaskToken, char: string): boolean {
	if (token === '#') return /^[0-9]$/.test(char)
	if (token === '@') return /^[A-Za-z]$/.test(char)
	return /^[0-9A-Za-z]$/.test(char)
}

/**
 * Read a mask into its positions. `#`, `@` and `*` are tokens; `\` makes the
 * next character a literal; every other character is a literal. Masks are
 * printable ASCII.
 *
 * @throws {FormatConfigurationError} for a non-ASCII character, a trailing
 * `\`, or a mask without a token.
 */
export function parseMask(mask: string | ParsedMask): ParsedMask {
	if (typeof mask !== 'string') return mask
	const slots: MaskSlot[] = []
	for (let index = 0; index < mask.length; index++) {
		const char = mask[index]!
		if (!/^[\x20-\x7e]$/.test(char)) {
			throw new FormatConfigurationError(`Mask ${JSON.stringify(mask)} has a character outside printable ASCII at position ${index + 1}.`)
		}
		if (char === '\\') {
			const next = mask[index + 1]
			if (next === undefined || !/^[\x20-\x7e]$/.test(next)) {
				throw new FormatConfigurationError(`Mask ${JSON.stringify(mask)} ends with an escape that has no character after it.`)
			}
			slots.push({ kind: 'literal', char: next })
			index++
			continue
		}
		const token = TOKENS[char]
		slots.push(token ? { kind: 'token', token } : { kind: 'literal', char })
	}
	const groups: number[] = []
	let run = 0
	for (const slot of slots) {
		if (slot.kind === 'token') run++
		else if (run > 0) {
			groups.push(run)
			run = 0
		}
	}
	if (run > 0) groups.push(run)
	const tokenCount = groups.reduce((total, count) => total + count, 0)
	if (tokenCount === 0) throw new FormatConfigurationError(`Mask ${JSON.stringify(mask)} has no token: use # for a digit, @ for a letter, * for either.`)
	return Object.freeze({ source: mask, slots: Object.freeze(slots), tokenCount, groups: Object.freeze(groups) })
}

/** Whether a string is a mask {@link parseMask} accepts. */
export function isValidMask(mask: string): boolean {
	try {
		parseMask(mask)
		return true
	} catch {
		return false
	}
}

function tokens(mask: ParsedMask): MaskToken[] {
	return mask.slots.flatMap((slot) => slot.kind === 'token' ? [slot.token] : [])
}

function example(mask: ParsedMask): { formatted: string; canonical: string } {
	let digit = 0
	let letter = 0
	const chars = mask.slots.map((slot) => {
		if (slot.kind === 'literal') return { char: slot.char, token: false }
		if (slot.token === '@') return { char: String.fromCharCode(65 + (letter++ % 26)), token: true }
		return { char: String((++digit) % 10), token: true }
	})
	return {
		formatted: chars.map((entry) => entry.char).join(''),
		canonical: chars.filter((entry) => entry.token).map((entry) => entry.char).join(''),
	}
}

function tokenKinds(mask: ParsedMask): string {
	const kinds = new Set(tokens(mask))
	if (kinds.size === 1 && kinds.has('#')) return 'digits'
	if (kinds.size === 1 && kinds.has('@')) return 'letters'
	if (!kinds.has('*') && kinds.size === 2) return 'digits and letters at fixed positions'
	return 'digits or letters'
}

/**
 * The shape a masked value takes, for a refusal to name: the mask, its
 * character count, and an example written with and without its literals.
 */
export function describeMask(mask: string | ParsedMask): string {
	const parsed = parseMask(mask)
	const { formatted, canonical } = example(parsed)
	const written = formatted === canonical ? canonical : `${formatted} or ${canonical}`
	return `${parsed.source}: ${parsed.tokenCount} ${tokenKinds(parsed)}, written ${written}`
}

function mismatch(mask: ParsedMask, problem: string): MaskResult {
	return { success: false, code: MASK_MISMATCH, message: `${problem} Expected ${describeMask(mask)}.` }
}

function readCanonical(mask: ParsedMask, input: string, partial: boolean): string | undefined {
	const expected = tokens(mask)
	if (partial ? input.length > expected.length : input.length !== expected.length) return undefined
	for (let index = 0; index < input.length; index++) {
		if (!fitsMaskToken(expected[index]!, input[index]!)) return undefined
	}
	return input
}

function readFormatted(mask: ParsedMask, input: string, partial: boolean): string | undefined {
	if (partial ? input.length > mask.slots.length : input.length !== mask.slots.length) return undefined
	let canonical = ''
	for (let index = 0; index < input.length; index++) {
		const slot = mask.slots[index]!
		const char = input[index]!
		if (slot.kind === 'literal') {
			if (char !== slot.char) return undefined
		} else if (fitsMaskToken(slot.token, char)) canonical += char
		else return undefined
	}
	return canonical
}

/**
 * Read a value through a mask into its canonical form: the token characters
 * only, in order. Input is read by position, never by stripping literals.
 *
 * A complete value is accepted in the canonical form (as many characters as
 * the mask has tokens, each fitting its token) or the formatted form (every
 * literal at its position, each token position fitting); when both match, the
 * formatted reading wins. In `progressive` mode a prefix is accepted in the
 * form `options.input` states. Reading a canonical value, or a canonical
 * prefix in canonical form, returns it unchanged.
 */
export function canonicalizeMasked(mask: string | ParsedMask, input: string, options: MaskCanonicalizeOptions = {}): MaskResult {
	const parsed = parseMask(mask)
	const formatted = readFormatted(parsed, input, false)
	if (formatted !== undefined) return { success: true, value: formatted, complete: true }
	const canonical = readCanonical(parsed, input, false)
	if (canonical !== undefined) return { success: true, value: canonical, complete: true }
	if (options.mode !== 'progressive') {
		return mismatch(parsed, `${JSON.stringify(input)} does not fill the mask.`)
	}
	const form = options.input ?? 'canonical'
	const prefix = form === 'formatted' ? readFormatted(parsed, input, true) : readCanonical(parsed, input, true)
	if (prefix !== undefined) return { success: true, value: prefix, complete: false }
	return mismatch(parsed, `${JSON.stringify(input)} is not the start of a value written in ${form} form.`)
}

/** Print a complete canonical value with the mask's literals. */
export function formatMasked(mask: string | ParsedMask, canonical: string): MaskResult {
	const parsed = parseMask(mask)
	if (readCanonical(parsed, canonical, false) === undefined) {
		return mismatch(parsed, `${JSON.stringify(canonical)} does not fit the mask.`)
	}
	let index = 0
	const value = parsed.slots.map((slot) => slot.kind === 'literal' ? slot.char : canonical[index++]!).join('')
	return { success: true, value, complete: true }
}

/**
 * One group of a complete canonical value: the token characters between two
 * literals. `group` is zero-based, so the second group of `###-##-####` in
 * `123456789` is `45`.
 */
export function maskGroup(mask: string | ParsedMask, canonical: string, group: number): MaskResult {
	const parsed = parseMask(mask)
	if (readCanonical(parsed, canonical, false) === undefined) {
		return mismatch(parsed, `${JSON.stringify(canonical)} does not fit the mask.`)
	}
	if (!Number.isInteger(group) || group < 0 || group >= parsed.groups.length) {
		return { success: false, code: MASK_MISMATCH, message: `Mask ${parsed.source} has ${parsed.groups.length} groups; there is no group ${group + 1}.` }
	}
	const start = parsed.groups.slice(0, group).reduce((total, count) => total + count, 0)
	return { success: true, value: canonical.slice(start, start + parsed.groups[group]!), complete: true }
}
