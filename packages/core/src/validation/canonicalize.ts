import {
	countryName,
	findSubdivision,
	isCountryCode,
	regionName,
	resolveAddressRegion,
	resolveCountry,
	resolveRegion,
	type PlaceCandidate,
	type PlaceFailure,
	type PlaceIssueCode,
} from '@asterdoc/format'
import { regionsProvider as regions } from '@asterdoc/format/regions'
import type { FormField } from '@asterdoc/types'
import type { ValidationError } from '@/types'

/** Whether input is a complete value or a value still being filled in. */
export type CanonicalizationMode = 'progressive' | 'complete'

export interface CanonicalizeOptions {
	/** The input locale: country names in it are accepted besides English names. */
	locale?: string
	mode: CanonicalizationMode
	/** The path issues are reported at, such as `fields.homeAddress`. */
	path?: string
	/**
	 * The value stored before this write. A patch to a `codes: true` address
	 * is canonicalized merged over the stored address, so a new region is read
	 * in the stored country and a new country is checked against the stored
	 * region.
	 */
	current?: unknown
}

/** Why an input could not be stored as a canonical value, with what to choose from instead. */
export interface CanonicalizationIssue {
	code: PlaceIssueCode
	path: string
	message: string
	candidates: PlaceCandidate[]
}

export type CanonicalizeResult =
	| { success: true; value: unknown }
	| { success: false; issues: CanonicalizationIssue[] }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function join(path: string, segment: string | number): string {
	return path === '' ? String(segment) : `${path}.${segment}`
}

function placeIssue(path: string, outcome: PlaceFailure): CanonicalizationIssue {
	return { code: outcome.code, path, message: outcome.message, candidates: [...outcome.candidates] }
}

/** Whether a field, or a field nested in it, stores canonical codes. */
export function hasCanonicalValues(field: FormField): boolean {
	switch (field.type) {
		case 'country':
		case 'region':
			return true
		case 'address':
			return field.codes === true
		case 'fieldset':
			return Object.values(field.fields).some(hasCanonicalValues)
		case 'list':
			return hasCanonicalValues(field.item)
		default:
			return false
	}
}

function canonicalAddress(value: Record<string, unknown>, options: CanonicalizeOptions, path: string, issues: CanonicalizationIssue[]): Record<string, unknown> {
	const next = { ...value }
	let country: string | undefined
	if (typeof value.country === 'string') {
		const outcome = resolveCountry(value.country, { locale: options.locale, regions })
		if (outcome.ok) next.country = country = outcome.value
		else issues.push(placeIssue(join(path, 'country'), outcome))
	}
	if (typeof value.region !== 'string') return next
	if (country === undefined) {
		if (typeof value.country !== 'string') {
			issues.push({ code: 'needs_country', path: join(path, 'region'), message: 'A subdivision is stored as a code, which needs the address country.', candidates: [] })
		}
		return next
	}
	const outcome = resolveAddressRegion(value.region, country, regions)
	if (outcome.ok) next.region = outcome.value
	else issues.push(placeIssue(join(path, 'region'), outcome))
	return next
}

function mergedOver(current: unknown, value: Record<string, unknown>): Record<string, unknown> {
	if (!isRecord(current)) return value
	const merged: Record<string, unknown> = { ...current }
	for (const [key, member] of Object.entries(value)) if (member !== undefined) merged[key] = member
	return merged
}

function canonicalize(field: FormField, value: unknown, options: CanonicalizeOptions, path: string, issues: CanonicalizationIssue[], current?: unknown): unknown {
	if (value === null || value === undefined || !hasCanonicalValues(field)) return value
	switch (field.type) {
		case 'country': {
			if (typeof value !== 'string') return value
			const outcome = resolveCountry(value, { locale: options.locale, regions })
			if (outcome.ok) return outcome.value
			issues.push(placeIssue(path, outcome))
			return value
		}
		case 'region': {
			if (typeof value !== 'string') return value
			const outcome = resolveRegion(value, { country: field.country, regions })
			if (outcome.ok) return outcome.value
			issues.push(placeIssue(path, outcome))
			return value
		}
		case 'address':
			return isRecord(value) ? canonicalAddress(mergedOver(current, value), options, path, issues) : value
		case 'fieldset': {
			if (!isRecord(value)) return value
			const next = { ...value }
			const stored = isRecord(current) ? current : undefined
			for (const [key, child] of Object.entries(field.fields)) {
				if (Object.hasOwn(value, key)) next[key] = canonicalize(child, value[key], options, join(path, key), issues, stored?.[key])
			}
			return next
		}
		case 'list':
			return Array.isArray(value)
				? value.map((item, index) => canonicalize(field.item, item, options, join(path, index), issues))
				: value
		default:
			return value
	}
}

/**
 * The canonical form of a field value: a `country` field's ISO 3166-1
 * alpha-2 code, a `region` field's full ISO 3166-2 code, and a `codes: true`
 * address's country and region codes, through `list` items and `fieldset`
 * members. Every other value passes through untouched. An input that does not
 * name exactly one place fails with the outcome and its candidates.
 */
export function canonicalizeFieldValue(field: FormField, value: unknown, options: CanonicalizeOptions): CanonicalizeResult {
	const issues: CanonicalizationIssue[] = []
	const canonical = canonicalize(field, value, options, options.path ?? '', issues, options.current)
	return issues.length > 0 ? { success: false, issues } : { success: true, value: canonical }
}

/** The members of an address that a `codes: true` address stores as codes. */
export type AddressCodeMember = 'country' | 'region'

/**
 * The canonical form of one member of a `codes: true` address: its country
 * as an alpha-2 code, or its region as the code after the dash, read in the
 * country of `owner`, the address the member is written into. A region with no
 * owner country fails with `needs_country`.
 */
export function canonicalizeAddressMember(
	member: AddressCodeMember,
	value: unknown,
	options: CanonicalizeOptions & { owner?: unknown },
): CanonicalizeResult {
	const path = options.path ?? member
	if (typeof value !== 'string') return { success: true, value }
	if (member === 'country') {
		const outcome = resolveCountry(value, { locale: options.locale, regions })
		if (!outcome.ok) return { success: false, issues: [placeIssue(path, outcome)] }
		const storedRegion = isRecord(options.owner) && typeof options.owner.region === 'string' ? options.owner.region : undefined
		if (storedRegion !== undefined) {
			const region = resolveAddressRegion(storedRegion, outcome.value, regions)
			if (!region.ok) return { success: false, issues: [placeIssue(path.endsWith('country') ? `${path.slice(0, -'country'.length)}region` : path, region)] }
		}
		return { success: true, value: outcome.value }
	}
	const ownerCountry = isRecord(options.owner) && typeof options.owner.country === 'string' ? options.owner.country : undefined
	const country = ownerCountry === undefined ? undefined : resolveCountry(ownerCountry, { locale: options.locale, regions })
	if (!country?.ok) {
		return { success: false, issues: [{ code: 'needs_country', path, message: 'A subdivision is stored as a code, which needs the address country.', candidates: [] }] }
	}
	const outcome = resolveAddressRegion(value, country.value, regions)
	return outcome.ok ? { success: true, value: outcome.value } : { success: false, issues: [placeIssue(path, outcome)] }
}

/** {@link canonicalizeFieldValue} over a record of field values keyed like `fields`. */
export function canonicalizeFieldValues(
	fields: Readonly<Record<string, FormField>> | undefined,
	values: unknown,
	options: CanonicalizeOptions,
): CanonicalizeResult {
	if (!fields || !isRecord(values)) return { success: true, value: values }
	const issues: CanonicalizationIssue[] = []
	const next: Record<string, unknown> = { ...values }
	const stored = isRecord(options.current) ? options.current : undefined
	for (const [key, field] of Object.entries(fields)) {
		if (Object.hasOwn(values, key)) next[key] = canonicalize(field, values[key], options, join(options.path ?? '', key), issues, stored?.[key])
	}
	return issues.length > 0 ? { success: false, issues } : { success: true, value: next }
}

/** A canonicalization issue as a validation error that keeps its code and candidates. */
export function canonicalizationError(issue: CanonicalizationIssue): ValidationError {
	return { field: issue.path, message: issue.message, code: issue.code, candidates: issue.candidates }
}

function countryWords(code: unknown, locale: string | undefined): string | undefined {
	return isCountryCode(code) ? countryName(code, locale) : undefined
}

function regionWords(code: unknown, locale: string | undefined): string | undefined {
	const subdivision = typeof code === 'string' ? findSubdivision(code, regions) : undefined
	return subdivision ? `${regionName(subdivision)}, ${countryName(subdivision.country, locale)}` : undefined
}

function collectNames(field: FormField, value: unknown, path: string, locale: string | undefined, names: Record<string, string>): void {
	if (value === null || value === undefined || !hasCanonicalValues(field)) return
	const add = (at: string, words: string | undefined) => {
		if (words !== undefined) names[at] = words
	}
	switch (field.type) {
		case 'country':
			return add(path, countryWords(value, locale))
		case 'region':
			return add(path, regionWords(value, locale))
		case 'address': {
			if (!isRecord(value)) return
			add(join(path, 'country'), countryWords(value.country, locale))
			if (isCountryCode(value.country) && typeof value.region === 'string') {
				add(join(path, 'region'), regionWords(`${value.country}-${value.region}`, locale))
			}
			return
		}
		case 'fieldset':
			if (!isRecord(value)) return
			for (const [key, child] of Object.entries(field.fields)) collectNames(child, value[key], join(path, key), locale, names)
			return
		case 'list':
			if (Array.isArray(value)) value.forEach((item, index) => collectNames(field.item, item, join(path, index), locale, names))
			return
		default:
			return
	}
}

/**
 * The words for each stored country and region code in a form's field values,
 * keyed by path (`fields.homeAddress.region`): `Canada` for a country and
 * `Ontario, Canada` for a subdivision. An agent confirms a value with these
 * words, never with a bare code. Country names are in `locale` (English by
 * default); subdivision names are English.
 */
export function placeDisplayNames(
	fields: Readonly<Record<string, FormField>> | undefined,
	values: unknown,
	options: { locale?: string } = {},
): Record<string, string> {
	const names: Record<string, string> = {}
	if (!fields || !isRecord(values)) return names
	for (const [key, field] of Object.entries(fields)) collectNames(field, values[key], join('fields', key), options.locale, names)
	return names
}
