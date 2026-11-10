import { describeMask, isValidMask } from '@asterdoc/format'

const CHOOSE = 'show the person the candidate names and ask which one they mean, then answer with that candidate\'s code.'

const SUBDIVISION_FOR_COUNTRY = 'A country candidate can be a subdivision of another country (US-GA, Georgia, United States): if the person picks it, answer with its country code, the part before the dash (US), and give the subdivision to the form\'s region field if it has one.'

const COUNTRY_INPUT = `Pass the country name or ISO 3166-1 code the person gave (Canada, CA or CAN); it is stored as the alpha-2 code. A name that matches no country or more than one is refused with candidates: ${CHOOSE} ${SUBDIVISION_FOR_COUNTRY}`

const REGION_INPUT = `Pass the state or province name, or its full ISO 3166-2 code, as the person gave it (Ontario or CA-ON); it is stored as the full code. A name that matches no subdivision or more than one is refused with candidates: ${CHOOSE}`

const countryRegionInput = (country: string) =>
	`Pass the state or province the person gave, as its name, its short code, or its full ISO 3166-2 code (${country}-<short code>); only subdivisions of ${country} are accepted, and it is stored as the full code. A name that matches no subdivision is refused with candidates: ${CHOOSE}`

const ADDRESS_CODES_INPUT = `\`country\` and \`region\` take the names or codes the person gave (Canada or CA, Ontario or ON); they are stored as codes. A name that matches no place or more than one is refused with candidates: ${CHOOSE} If the person picks a subdivision candidate for \`country\` (US-GA), answer \`country\` with the part before the dash (US) and \`region\` with the part after it (GA).`

/**
 * What an agent passes for a field whose input the engine converts before it
 * is stored, as a short note to put next to the field: a `country`
 * field, a `region` field (with or without its `country` constraint), an
 * `address` with `codes: true`, and a `text` field with a valid `mask`. Every
 * other field, and a value that is not a field definition, returns
 * `undefined`.
 *
 * Agent tool layers show this text instead of writing their own, so every
 * agent reads the same contract.
 */
export function fieldInputGuidance(field: unknown): string | undefined {
	if (field === null || typeof field !== 'object' || Array.isArray(field)) return undefined
	const definition = field as { type?: unknown; country?: unknown; codes?: unknown; mask?: unknown }
	if (definition.type === 'country') return COUNTRY_INPUT
	if (definition.type === 'region') {
		return typeof definition.country === 'string' ? countryRegionInput(definition.country) : REGION_INPUT
	}
	if (definition.type === 'address' && definition.codes === true) return ADDRESS_CODES_INPUT
	if (definition.type === 'text' && typeof definition.mask === 'string' && isValidMask(definition.mask)) {
		return `Accepts the value with or without its separators (${describeMask(definition.mask)}); it is stored without them`
	}
	return undefined
}
