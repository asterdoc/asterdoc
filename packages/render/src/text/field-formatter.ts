import { isSensitivePath } from '../sensitive'
import type {
	FormatIssue,
	FormatResult,
	Formatter,
	FormatterProgressivePolicy,
	EnumOption,
	EnumOptionValue,
	Form,
	FormField,
	FormAnnex,
	DefsSection,
	LayerBooleanFormat,
	LayerCase,
	LayerCountryFormat,
	LayerDateFormat,
	LayerPhoneFormat,
	LayerRegionFormat,
	ValueTextFormat,
	MoneyFormatOptions,
	PersonFormatOptions,
} from '@asterdoc/types'
import {
	MASK_MISMATCH,
	MISSING_RATING_SCALE,
	UNSUPPORTED_COUNTRY_LAYOUT,
	UNSUPPORTED_LIST_JOIN,
	REGIONS_ENTRY_POINT,
	countryName,
	displayRegion,
	hasSubdivisions,
	resolveAddressRegion,
	resolveCountry,
	resolveRegion,
	type PlaceOutcome,
	type RegionsProvider,
	canonicalizeMasked,
	formatMasked,
} from '@asterdoc/format'
import { bindingDataPath, renderDataPath } from '../layer-bindings'
import { getPath, pathSegments } from '../path'

/** Explicit policy for rendering a value that is missing or incomplete. */
export type ProgressiveFormattingOptions = FormatterProgressivePolicy

export interface FieldFormattingOptions {
	/** Enable placeholders for missing/incomplete values for a progressive preview. */
	progressive?: ProgressiveFormattingOptions
	/**
	 * What a choice prints: its option label (the default) or its option value.
	 * A PDF box writes the value, the code the form expects, such as "C" or "5",
	 * unless its layer or binding format sets `choice.display`.
	 */
	choices?: 'label' | 'value'
	/** How every phone number prints. A layer that declares `format.phone` passes it here. */
	phone?: LayerPhoneFormat
	/** The labels every boolean prints with. A layer that declares `format.boolean` passes it here. */
	boolean?: LayerBooleanFormat
	/**
	 * Options for every money value, applied over the formatter's own policy.
	 * A PDF layer that declares `format.money` passes it here.
	 */
	money?: MoneyFormatOptions
	/**
	 * The numeric order every date value prints in. A PDF layer that declares
	 * `format.date` passes it here.
	 */
	date?: LayerDateFormat
	/** How countries print: an address's `country` member and `country` fields. */
	country?: LayerCountryFormat
	/** How subdivisions print: an address's `region` member and `region` fields. */
	region?: LayerRegionFormat
	/**
	 * `upper` prints every value in upper case with the formatter locale's
	 * rules, after all other formatting. Email, uri and uuid values keep their
	 * case. A layer that declares `format.case` passes it here.
	 */
	case?: LayerCase
	/** How every person value prints. A layer that declares `format.person` passes it here. */
	person?: PersonFormatOptions
	/**
	 * How text values print through a mask: the field's own mask by default,
	 * the canonical value with `mask: false`, or another mask.
	 */
	text?: ValueTextFormat
}

type RecordValue = Record<string, unknown>

const organizationPartyKeys = new Set(['legalName', 'domicile', 'entityType', 'entityId', 'taxId'])

/** Match core's party inference: any organization-only member makes an organization; otherwise it is a person. */
function inferredPartyType(value: RecordValue): 'person' | 'organization' {
	return Object.keys(value).some((key) => organizationPartyKeys.has(key)) ? 'organization' : 'person'
}

const rawValues = new WeakMap<FormattedFieldValue, unknown>()
const renderedValues = new WeakMap<FormattedFieldValue, string>()
const placeholders = new WeakSet<FormattedFieldValue>()

/**
 * A template value that keeps its source value for logic/property access while
 * supplying the selected formatter's text for interpolation.
 */
export class FormattedFieldValue {
	constructor(value: unknown, text: string, members: unknown = value) {
		if (members !== null && typeof members === 'object') {
			for (const [key, member] of Object.entries(members)) {
				if (key === 'toString' || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
				Object.defineProperty(this, key, { configurable: false, enumerable: true, value: member, writable: false })
			}
		}
		rawValues.set(this, value)
		renderedValues.set(this, text)
	}

	get raw(): unknown {
		return rawValues.get(this)
	}

	toString(): string {
		return renderedValues.get(this) ?? ''
	}
}

export function unwrapFormattedValue(value: unknown): unknown {
	return value instanceof FormattedFieldValue ? value.raw : value
}

/** Raised when a declared artifact value cannot be presented. */
export class ArtifactFieldFormatError extends Error {
	readonly path: string
	readonly fieldType: string
	readonly status: string
	readonly issues: readonly FormatIssue[]

	constructor(
		path: string,
		fieldType: string,
		status: string,
		issues: readonly FormatIssue[],
		cause?: unknown,
	) {
		const detail = issues.map((entry) => entry.message).join('; ') || `Unable to format ${fieldType}.`
		super(`Cannot format ${path} (${fieldType}, ${status}): ${detail}`, cause instanceof Error ? { cause } : undefined)
		this.name = 'ArtifactFieldFormatError'
		this.path = path
		this.fieldType = fieldType
		this.status = status
		this.issues = issues
	}
}

/**
 * A format error with no sensitive value in it. An error at a path
 * {@link isSensitivePath} names, or with an issue at one, is rebuilt from each
 * issue's `redactedMessage`, which names the value only by kind and length,
 * and without its causes; any other error is returned as it is.
 */
export function withoutSensitiveValues(form: Form | undefined, error: unknown): unknown {
	if (!(error instanceof ArtifactFieldFormatError) || !form) return error
	const sensitive = isSensitivePath(form, error.path) || error.issues.some((issue) => issue.path !== undefined && isSensitivePath(form, issue.path))
	if (!sensitive) return error
	const issues = error.issues.map(({ cause: _cause, redactedMessage, ...issue }) => ({ ...issue, message: redactedMessage ?? `The value could not be formatted (${issue.code}).` }))
	return new ArtifactFieldFormatError(error.path, error.fieldType, error.status, issues)
}

function isRecord(value: unknown): value is RecordValue {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(value: unknown): value is null | undefined {
	return value === null || value === undefined
}

function childPath(path: string, segment: string | number): string {
	return typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`
}

function formatIssue(path: string, fieldType: string, code: string, message: string, redactedMessage?: string): ArtifactFieldFormatError {
	return new ArtifactFieldFormatError(path, fieldType, 'invalid', [{ code, message, ...(redactedMessage !== undefined && { redactedMessage }), path, kind: fieldType }])
}

function progressiveText(options: FieldFormattingOptions | undefined, status: 'missing' | 'incomplete'): string | undefined {
	if (!options?.progressive) return undefined
	return status === 'missing'
		? options.progressive.missing ?? '—'
		: options.progressive.incomplete ?? '…'
}

function placeholder(value: unknown, text: string): FormattedFieldValue {
	const result = new FormattedFieldValue(value, text)
	placeholders.add(result)
	return result
}

function missingValue(value: unknown, path: string, fieldType: string, options?: FieldFormattingOptions): unknown {
	const text = progressiveText(options, 'missing')
	return text === undefined ? value : placeholder(value, text)
}

const CASE_KEEPING_TYPES = new Set(['email', 'uri', 'uuid'])

/**
 * A formatted value in the case `options.case` asks for. Progressive
 * placeholders and email, uri and uuid values keep their case.
 */
function cased(formatter: Formatter, result: unknown, value: unknown, fieldType: string, options?: FieldFormattingOptions): unknown {
	if (options?.case !== 'upper' || CASE_KEEPING_TYPES.has(fieldType)) return result
	if (result instanceof FormattedFieldValue) {
		if (placeholders.has(result)) return result
		return new FormattedFieldValue(result.raw, String(result).toLocaleUpperCase(formatter.locale))
	}
	return typeof result === 'string' ? new FormattedFieldValue(value, result.toLocaleUpperCase(formatter.locale)) : result
}

function presentIssuePath(path: string, issuePath: string | undefined): string {
	if (!issuePath) return path
	if (issuePath === path || issuePath.startsWith(`${path}.`) || issuePath.startsWith(`${path}[`)) return issuePath
	return issuePath.startsWith('[') ? `${path}${issuePath}` : `${path}.${issuePath}`
}

function presentIssues(issues: readonly FormatIssue[], path: string, fieldType: string): FormatIssue[] {
	return issues.map((issue) => ({
		...issue,
		path: presentIssuePath(path, issue.path),
		kind: issue.kind ?? fieldType,
	}))
}

function presentResult(
	result: FormatResult,
	value: unknown,
	path: string,
	fieldType: string,
	options?: FieldFormattingOptions,
): unknown {
	if (result.success) return new FormattedFieldValue(value, result.value)
	if (result.status === 'missing') return missingValue(value, path, fieldType, options)
	if (result.status === 'incomplete') {
		const text = progressiveText(options, 'incomplete')
		if (text !== undefined) return placeholder(value, text)
	}
	throw new ArtifactFieldFormatError(path, fieldType, result.status, presentIssues(result.issues, path, fieldType))
}

function guardFormatting<T>(path: string, fieldType: string, run: () => T): T {
	try {
		return run()
	} catch (error) {
		if (error instanceof ArtifactFieldFormatError) throw error
		throw new ArtifactFieldFormatError(path, fieldType, 'error', [{
			code: 'formatter_error',
			message: error instanceof Error ? error.message : 'Unexpected formatter failure.',
			path,
			kind: fieldType,
			cause: error,
		}], error)
	}
}

function callFormatter(
	path: string,
	fieldType: string,
	value: unknown,
	call: () => FormatResult,
	options?: FieldFormattingOptions,
): unknown {
	return guardFormatting(path, fieldType, () => presentResult(call(), value, path, fieldType, options))
}

/**
 * Formats a value whose presentation the runtime may not carry, substituting
 * the documented plain form and keeping the formatter's reason on the result.
 * A rating whose field declares no scale and a locale with no list conjunction
 * are gaps in what can be said, not faults in the document, so the value still
 * prints; an invalid value is still refused.
 */
interface FallbackFormatting {
	/** The formatter's `unsupported` code this fallback answers, and only that code. */
	readonly code: string
	/** The documented plain presentation to substitute. */
	readonly substitute: () => FormatResult
	readonly options?: FieldFormattingOptions
}

function callFormatterWithFallback(
	path: string,
	fieldType: string,
	value: unknown,
	call: () => FormatResult,
	fallback: FallbackFormatting,
): unknown {
	return guardFormatting(path, fieldType, () => {
		const result = call()
		const fellShort = !result.success && result.status === 'unsupported' && result.issues.some((entry) => entry.code === fallback.code)
		if (!fellShort) return presentResult(result, value, path, fieldType, fallback.options)
		const substitute = fallback.substitute()
		if (!substitute.success) return presentResult(substitute, value, path, fieldType, fallback.options)
		return new FormattedFieldValue(value, substitute.value)
	})
}

function recordInput(value: unknown, path: string, fieldType: string): RecordValue {
	if (isRecord(value)) return value
	throw formatIssue(path, fieldType, 'invalid_value', `Expected an object for ${fieldType}.`)
}

function dateInput(value: unknown, path: string, fieldType: string): string | Date {
	if (typeof value === 'string' || value instanceof Date) return value
	throw formatIssue(path, fieldType, 'invalid_value', `Expected an ISO string or Date for ${fieldType}.`)
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function patternDate(
	formatter: Formatter,
	value: unknown,
	path: string,
	fieldType: string,
	date: LayerDateFormat,
	options?: FieldFormattingOptions,
): unknown {
	return guardFormatting(path, fieldType, () => {
		const result = formatter.safeFormatDate(dateInput(value, path, fieldType))
		if (!result.success) return presentResult(result, value, path, fieldType, options)
		const parts = typeof value === 'string' ? CALENDAR_DATE.exec(value) : null
		if (!parts) throw formatIssue(path, fieldType, 'invalid_value', `The layer prints dates as ${date.pattern}, which needs a calendar date written YYYY-MM-DD.`)
		const [, year, month, day] = parts as unknown as [string, string, string, string]
		const text = date.pattern === 'MM/DD/YYYY' ? `${month}/${day}/${year}`
			: date.pattern === 'DD/MM/YYYY' ? `${day}/${month}/${year}`
				: `${year}-${month}-${day}`
		return new FormattedFieldValue(value, text)
	})
}

function placeValue(outcome: PlaceOutcome, path: string, fieldType: string): string {
	if (outcome.ok) return outcome.value
	throw new ArtifactFieldFormatError(path, fieldType, 'invalid', [{ code: outcome.code, message: outcome.message, ...(outcome.redactedMessage !== undefined && { redactedMessage: outcome.redactedMessage }), path, kind: fieldType }])
}

function countryCode(value: unknown, formatter: Formatter, path: string, fieldType: string): string {
	return placeValue(resolveCountry(stringInput(value, path, fieldType), { locale: formatter.locale, regions: formatter.providers.regions }), path, fieldType)
}

function regionsOf(formatter: Formatter, path: string, fieldType: string): RegionsProvider {
	const regions = formatter.providers.regions
	if (regions) return regions
	throw formatIssue(path, fieldType, 'missing_format_provider', `A region format needs the regions provider: create the formatter with providers: { regions: regionsProvider } from ${REGIONS_ENTRY_POINT}.`)
}

function countryText(code: string, format: LayerCountryFormat, formatter: Formatter): string {
	return format.display === 'name' ? countryName(code, formatter.locale) : code
}

function regionText(formatter: Formatter, value: unknown, country: string | undefined, format: LayerRegionFormat, path: string, fieldType: string): string {
	const text = stringInput(value, path, fieldType)
	const regions = regionsOf(formatter, path, fieldType)
	if (country === undefined) return displayRegion(placeValue(resolveRegion(text, { regions }), path, fieldType), format.display, regions)
	const short = placeValue(resolveAddressRegion(text, country, regions), path, fieldType)
	return hasSubdivisions(country, regions) ? displayRegion(`${country}-${short}`, format.display, regions) : short
}

function displayedAddress(
	formatter: Formatter,
	value: RecordValue,
	path: string,
	options: FieldFormattingOptions | undefined,
): { address: RecordValue; layoutCountry?: string } {
	if (!options?.country && !options?.region) return { address: value }
	const code = isMissing(value.country) ? undefined : countryCode(value.country, formatter, childPath(path, 'country'), 'address')
	const address: RecordValue = { ...value }
	if (options.country && code !== undefined) address.country = countryText(code, options.country, formatter)
	if (options.region && !isMissing(value.region)) {
		const regionPath = childPath(path, 'region')
		if (code === undefined) throw formatIssue(regionPath, 'address', 'needs_country', 'A subdivision printed as a code or name needs the address country.')
		address.region = regionText(formatter, value.region, code, options.region, regionPath, 'address')
	}
	return { address, ...(code !== undefined && { layoutCountry: code }) }
}

function addressMemberText(formatter: Formatter, value: unknown, path: string, member: string, options?: FieldFormattingOptions): string | undefined {
	if (!isRecord(value)) return undefined
	if (member === 'country' && options?.country && !isMissing(value.country)) {
		return countryText(countryCode(value.country, formatter, childPath(path, 'country'), 'address'), options.country, formatter)
	}
	if (member === 'region' && options?.region && !isMissing(value.region)) {
		return displayedAddress(formatter, value, path, { region: options.region }).address.region as string
	}
	return undefined
}

/**
 * An address's `country` or `region` member as a country or region format
 * prints it, read in the address it sits in; `undefined` when no such format
 * applies to the member.
 *
 * @throws {ArtifactFieldFormatError} when the member or its address country does not normalize.
 */
export function formatAddressMember(formatter: Formatter, address: unknown, path: string, member: string, options?: FieldFormattingOptions): string | undefined {
	return guardFormatting(path, 'address', () => addressMemberText(formatter, address, path, member, options))
}

function address(formatter: Formatter, value: unknown, path: string, fieldType: string, options?: FieldFormattingOptions): unknown {
	return guardFormatting(path, fieldType, () => {
		const stored = recordInput(value, path, fieldType)
		const { address: shown, layoutCountry } = displayedAddress(formatter, stored, path, options)
		const layout = layoutCountry === undefined ? {} : { layoutCountry }
		const result = callFormatterWithFallback(
			path,
			fieldType,
			value,
			() => formatter.safeFormatAddress(shown, layout),
			{
				code: UNSUPPORTED_COUNTRY_LAYOUT,
				substitute: () => formatter.safeFormatAddress(shown, { layout: 'generic' }),
				options,
			},
		)
		return shown === stored || !(result instanceof FormattedFieldValue) ? result : new FormattedFieldValue(value, String(result), shown)
	})
}

function country(formatter: Formatter, value: unknown, path: string, options?: FieldFormattingOptions): unknown {
	if (!options?.country) return stringInput(value, path, 'country')
	return new FormattedFieldValue(value, countryText(countryCode(value, formatter, path, 'country'), options.country, formatter))
}

function region(formatter: Formatter, field: Extract<FormField, { type: 'region' }>, value: unknown, path: string, options?: FieldFormattingOptions): unknown {
	if (!options?.region) return stringInput(value, path, 'region')
	const text = stringInput(value, path, 'region')
	const regions = regionsOf(formatter, path, 'region')
	const code = placeValue(resolveRegion(text, { ...(field.country !== undefined && { country: field.country }), regions }), path, 'region')
	return new FormattedFieldValue(value, displayRegion(code, options.region.display, regions))
}

function stringInput(value: unknown, path: string, fieldType: string): string {
	if (typeof value === 'string') return value
	throw formatIssue(path, fieldType, 'invalid_value', `Expected a string for ${fieldType}.`)
}

/** The mask a text value prints with: the field's, none with `mask: false`, or the one the format names. */
export function effectiveMask(field: FormField, text: ValueTextFormat | undefined): string | undefined {
	if (field.type !== 'text') return undefined
	const choice = text?.mask
	if (choice === false) return undefined
	return typeof choice === 'string' ? choice : field.mask
}

function maskedText(field: FormField, value: unknown, path: string, options?: FieldFormattingOptions): unknown {
	const text = stringInput(value, path, field.type)
	const mask = effectiveMask(field, options?.text)
	if (mask === undefined) return text
	const printed = formatMasked(mask, text)
	if (printed.success) return new FormattedFieldValue(value, printed.value)
	if (options?.progressive && canonicalizeMasked(mask, text, { mode: 'progressive' }).success) {
		return placeholder(value, progressiveText(options, 'incomplete')!)
	}
	throw formatIssue(path, field.type, MASK_MISMATCH, printed.message, printed.redactedMessage)
}

function numberInput(value: unknown, path: string, fieldType: string): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	throw formatIssue(path, fieldType, 'invalid_value', `Expected a finite number for ${fieldType}.`)
}

function booleanInput(value: unknown, path: string, fieldType: string): boolean {
	if (typeof value === 'boolean') return value
	throw formatIssue(path, fieldType, 'invalid_value', 'Expected a boolean value.')
}

function optionInput(value: unknown, path: string, fieldType: string): EnumOptionValue {
	if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
	throw formatIssue(path, fieldType, 'invalid_value', `Expected a string or number ${fieldType} value.`)
}

function optionListInput(value: unknown, path: string, fieldType: string): readonly EnumOptionValue[] {
	if (!Array.isArray(value)) throw formatIssue(path, fieldType, 'invalid_value', `Expected an array of ${fieldType} values.`)
	return value.map((entry) => optionInput(entry, path, fieldType))
}

/**
 * The documented fallback for a runtime whose locale data carries no list
 * conjunction: the same option labels, joined with a comma. It asks the
 * formatter for each label, so the labels are still the formatter's.
 */
function commaJoinedLabels(
	formatter: Formatter,
	values: readonly EnumOptionValue[],
	options: readonly EnumOption[],
): FormatResult {
	const labels: string[] = []
	for (const value of values) {
		const result = formatter.safeFormatEnum(value, { options })
		if (!result.success) return result
		labels.push(result.value)
	}
	return { success: true, status: 'formatted', value: labels.join(', ') }
}

function formatLeaf(
	formatter: Formatter,
	field: FormField,
	value: unknown,
	path: string,
	options?: FieldFormattingOptions,
): unknown {
	if (isMissing(value)) return missingValue(value, path, field.type, options)
	return cased(formatter, formatPresentLeaf(formatter, field, value, path, options), value, field.type, options)
}

function formatPresentLeaf(
	formatter: Formatter,
	field: FormField,
	value: unknown,
	path: string,
	options?: FieldFormattingOptions,
): unknown {
	try {
		switch (field.type) {
			case 'money': return callFormatter(path, field.type, value, () => formatter.safeFormatMoney(recordInput(value, path, field.type), options?.money), options)
			case 'address': return address(formatter, value, path, field.type, options)
			case 'country': return country(formatter, value, path, options)
			case 'region': return region(formatter, field, value, path, options)
			case 'phone': return callFormatter(path, field.type, value, () => formatter.safeFormatPhone(typeof value === 'string' ? value : recordInput(value, path, field.type), options?.phone), options)
			case 'person': return callFormatter(path, field.type, value, () => formatter.safeFormatPerson(recordInput(value, path, field.type), options?.person), options)
			case 'organization': return callFormatter(path, field.type, value, () => formatter.safeFormatOrganization(recordInput(value, path, field.type)), options)
			case 'coordinate': return callFormatter(path, field.type, value, () => formatter.safeFormatCoordinate(recordInput(value, path, field.type)), options)
			case 'bbox': return callFormatter(path, field.type, value, () => formatter.safeFormatBbox(recordInput(value, path, field.type)), options)
			case 'duration': return callFormatter(path, field.type, value, () => formatter.safeFormatDuration(stringInput(value, path, field.type)), options)
			case 'identification': return callFormatter(path, field.type, value, () => formatter.safeFormatIdentification(recordInput(value, path, field.type)), options)
			case 'date': return options?.date
				? patternDate(formatter, value, path, field.type, options.date, options)
				: callFormatter(path, field.type, value, () => formatter.safeFormatDate(dateInput(value, path, field.type)), options)
			case 'datetime': return callFormatter(path, field.type, value, () => formatter.safeFormatDatetime(dateInput(value, path, field.type)), options)
			case 'time': return callFormatter(path, field.type, value, () => formatter.safeFormatTime(stringInput(value, path, field.type)), options)
			case 'number': return callFormatter(path, field.type, value, () => formatter.safeFormatNumber(numberInput(value, path, field.type)), options)
			case 'percentage': return callFormatter(path, field.type, value, () => formatter.safeFormatPercentage(numberInput(value, path, field.type)), options)
			case 'boolean': return callFormatter(path, field.type, value, () => formatter.safeFormatBoolean(booleanInput(value, path, field.type), options?.boolean), options)
			case 'enum': if (options?.choices === 'value') {
				const choice = optionInput(value, path, field.type)
				return new FormattedFieldValue(value, String(choice))
			}
				return callFormatter(path, field.type, value, () => formatter.safeFormatEnum(optionInput(value, path, field.type), { options: field.enum }), options)
			case 'multiselect': if (options?.choices === 'value') {
				return new FormattedFieldValue(value, optionListInput(value, path, field.type).map(String).join(', '))
			}
				return callFormatterWithFallback(
				path,
				field.type,
				value,
				() => formatter.safeFormatMultiselect(optionListInput(value, path, field.type), { options: field.enum }),
				{
					code: UNSUPPORTED_LIST_JOIN,
					substitute: () => commaJoinedLabels(formatter, optionListInput(value, path, field.type), field.enum),
					options,
				},
			)
			case 'text': return maskedText(field, value, path, options)
			case 'email':
			case 'uuid':
			case 'uri': return stringInput(value, path, field.type)
			// An absent `max` is left out, so a formatter-level rating scale still applies.
			case 'rating': return callFormatterWithFallback(
				path,
				field.type,
				value,
				() => formatter.safeFormatRating(numberInput(value, path, field.type), field.max === undefined ? {} : { max: field.max }),
				{
					code: MISSING_RATING_SCALE,
					substitute: () => formatter.safeFormatNumber(numberInput(value, path, field.type)),
					options,
				},
			)
		}
	} catch (error) {
		if (error instanceof ArtifactFieldFormatError) throw error
		throw new ArtifactFieldFormatError(path, field.type, 'error', [{
			code: 'field_format_error',
			message: error instanceof Error ? error.message : 'Unexpected field formatting failure.',
			path,
			kind: field.type,
			cause: error,
		}], error)
	}
}

export function formatFieldValue(
	formatter: Formatter,
	field: FormField,
	value: unknown,
	path: string,
	options?: FieldFormattingOptions,
): unknown {
	if (field.type === 'list') {
		if (isMissing(value)) return missingValue(value, path, field.type, options)
		if (!Array.isArray(value)) throw formatIssue(path, field.type, 'invalid_value', 'Expected an array for a list field.')
		return value.map((item, index) => formatFieldValue(formatter, field.item, item, childPath(path, index), options))
	}

	if (field.type === 'fieldset') {
		if (isMissing(value)) return missingValue(value, path, field.type, options)
		if (!isRecord(value)) throw formatIssue(path, field.type, 'invalid_value', 'Expected an object for a fieldset.')
		const result: RecordValue = { ...value }
		for (const [key, child] of Object.entries(field.fields)) {
			if (Object.prototype.hasOwnProperty.call(value, key) || options?.progressive) {
				result[key] = formatFieldValue(formatter, child, value[key], childPath(path, key), options)
			}
		}
		return result
	}

	return formatLeaf(formatter, field, value, path, options)
}

export function formatDefinitionValue(
	formatter: Formatter,
	type: string,
	value: unknown,
	path: string,
	options?: FieldFormattingOptions,
): unknown {
	if (isMissing(value)) return missingValue(value, path, type, options)
	return cased(formatter, formatPresentDefinition(formatter, type, value, path, options), value, type, options)
}

function partyOptions(partyType: 'person' | 'organization', options?: FieldFormattingOptions) {
	return { partyType, ...(options?.person && { person: options.person }) }
}

function formatPresentDefinition(
	formatter: Formatter,
	type: string,
	value: unknown,
	path: string,
	options?: FieldFormattingOptions,
): unknown {
	try {
		switch (type) {
			case 'money': return callFormatter(path, type, value, () => formatter.safeFormatMoney(recordInput(value, path, type), options?.money), options)
			case 'address': return address(formatter, value, path, type, options)
			case 'phone': return callFormatter(path, type, value, () => formatter.safeFormatPhone(typeof value === 'string' ? value : recordInput(value, path, type), options?.phone), options)
			case 'person': return callFormatter(path, type, value, () => formatter.safeFormatPerson(recordInput(value, path, type), options?.person), options)
			case 'organization': return callFormatter(path, type, value, () => formatter.safeFormatOrganization(recordInput(value, path, type)), options)
			case 'party': {
				const party = recordInput(value, path, type)
				return callFormatter(path, type, value, () => formatter.safeFormatParty(party, partyOptions(inferredPartyType(party), options)), options)
			}
			case 'coordinate': return callFormatter(path, type, value, () => formatter.safeFormatCoordinate(recordInput(value, path, type)), options)
			case 'bbox': return callFormatter(path, type, value, () => formatter.safeFormatBbox(recordInput(value, path, type)), options)
			case 'duration': return callFormatter(path, type, value, () => formatter.safeFormatDuration(stringInput(value, path, type)), options)
			case 'identification': return callFormatter(path, type, value, () => formatter.safeFormatIdentification(recordInput(value, path, type)), options)
			case 'attachment': return callFormatter(path, type, value, () => formatter.safeFormatAttachment(recordInput(value, path, type)), options)
			case 'signature': return callFormatter(path, type, value, () => formatter.safeFormatSignature(recordInput(value, path, type)), options)
			case 'date': return options?.date
				? patternDate(formatter, value, path, type, options.date, options)
				: callFormatter(path, type, value, () => formatter.safeFormatDate(dateInput(value, path, type)), options)
			case 'datetime': return callFormatter(path, type, value, () => formatter.safeFormatDatetime(dateInput(value, path, type)), options)
			case 'time': return callFormatter(path, type, value, () => formatter.safeFormatTime(stringInput(value, path, type)), options)
			case 'number': return callFormatter(path, type, value, () => formatter.safeFormatNumber(numberInput(value, path, type)), options)
			// A computed value carries no field, so only a formatter-level scale can apply.
			case 'rating': return callFormatterWithFallback(
				path,
				type,
				value,
				() => formatter.safeFormatRating(numberInput(value, path, type)),
				{
					code: MISSING_RATING_SCALE,
					substitute: () => formatter.safeFormatNumber(numberInput(value, path, type)),
					options,
				},
			)
			case 'integer': {
				const number = numberInput(value, path, type)
				if (!Number.isInteger(number)) throw formatIssue(path, type, 'invalid_value', 'Expected an integer value.')
				return callFormatter(path, type, value, () => formatter.safeFormatNumber(number), options)
			}
			case 'percentage': return callFormatter(path, type, value, () => formatter.safeFormatPercentage(numberInput(value, path, type)), options)
			case 'boolean': return callFormatter(path, type, value, () => formatter.safeFormatBoolean(booleanInput(value, path, type), options?.boolean), options)
			case 'string': return stringInput(value, path, type)
			default: throw new ArtifactFieldFormatError(path, type, 'unsupported', [{ code: 'unsupported_type', message: `Unsupported computed value type ${JSON.stringify(type)}.`, path, kind: type }])
		}
	} catch (error) {
		if (error instanceof ArtifactFieldFormatError) throw error
		throw new ArtifactFieldFormatError(path, type, 'error', [{ code: 'computed_format_error', message: error instanceof Error ? error.message : 'Unexpected computed value formatting failure.', path, kind: type, cause: error }], error)
	}
}

export function formatParties(
	formatter: Formatter,
	form: Form,
	value: unknown,
	path: string,
	options?: FieldFormattingOptions,
	role?: string,
): unknown {
	if (isMissing(value)) return missingValue(value, path, 'party', options)
	if (Array.isArray(value)) return value.map((entry, index) => formatParties(formatter, form, entry, childPath(path, index), options, role))
	return formatPartyValue(formatter, role ? form.parties?.[role]?.partyType : undefined, value, path, options)
}

/** One party, formatted as its role's declared party type, or as the type its members show. */
export function formatPartyValue(
	formatter: Formatter,
	partyType: string | undefined,
	value: unknown,
	path: string,
	options?: FieldFormattingOptions,
): unknown {
	if (isMissing(value)) return missingValue(value, path, 'party', options)
	const party = recordInput(value, path, 'party')
	const resolvedPartyType = partyType === 'person' || partyType === 'organization' ? partyType : inferredPartyType(party)
	return cased(formatter, callFormatter(path, 'party', value, () => formatter.safeFormatParty(party, partyOptions(resolvedPartyType, options)), options), value, 'party', options)
}

/** One attachment, such as an annex. */
export function formatAttachmentValue(formatter: Formatter, value: unknown, path: string, options?: FieldFormattingOptions): unknown {
	if (isMissing(value)) return missingValue(value, path, 'attachment', options)
	return cased(formatter, callFormatter(path, 'attachment', value, () => formatter.safeFormatAttachment(recordInput(value, path, 'attachment')), options), value, 'attachment', options)
}

function formatAnnexes(
	formatter: Formatter,
	form: Form,
	value: unknown,
	options?: FieldFormattingOptions,
): unknown {
	if (!isRecord(value)) {
		if (isMissing(value)) return options?.progressive ? {} : value
		throw formatIssue('annexes', 'attachment', 'invalid_value', 'Expected annexes to be an object.')
	}
	const result: RecordValue = { ...value }
	for (const [key, annexValue] of Object.entries(value)) {
		const path = `annexes.${key}`
		const definition: FormAnnex | undefined = form.annexes?.[key]
		if (!definition && !form.allowAdditionalAnnexes) throw formatIssue(path, 'attachment', 'unknown_path', `Unknown annex ${JSON.stringify(key)}.`)
		if (isMissing(annexValue)) result[key] = missingValue(annexValue, path, 'attachment', options)
		else result[key] = cased(formatter, callFormatter(path, 'attachment', annexValue, () => formatter.safeFormatAttachment(recordInput(annexValue, path, 'attachment')), options), annexValue, 'attachment', options)
	}
	for (const key of Object.keys(form.annexes ?? {})) {
		if (!Object.prototype.hasOwnProperty.call(result, key) && options?.progressive) {
			result[key] = missingValue(undefined, `annexes.${key}`, 'attachment', options)
		}
	}
	return result
}

function formatDefs(
	formatter: Formatter,
	definitions: DefsSection | undefined,
	values: unknown,
	options?: FieldFormattingOptions,
): unknown {
	if (!isRecord(values)) {
		if (isMissing(values)) return values
		throw formatIssue('defs', 'computed', 'invalid_value', 'Expected computed values to be an object.')
	}
	const result: RecordValue = { ...values }
	for (const [key, definition] of Object.entries(definitions ?? {})) {
		if (Object.prototype.hasOwnProperty.call(values, key)) {
			result[key] = formatDefinitionValue(formatter, definition.type, values[key], `defs.${key}`, options)
		} else if (options?.progressive) {
			result[key] = missingValue(undefined, `defs.${key}`, definition.type, options)
		}
	}
	for (const key of Object.keys(values)) {
		if (!definitions?.[key]) throw formatIssue(`defs.${key}`, 'computed', 'unknown_path', `Unknown computed value ${JSON.stringify(key)}.`)
	}
	return result
}

/** Apply one formatter to all declared field-aware values in a text render payload. */
export function formatFieldData(
	data: RecordValue,
	form: Form,
	formatter: Formatter,
	options?: FieldFormattingOptions,
): RecordValue {
	const result: RecordValue = { ...data }
	const nestedFields = isRecord(data.fields)
	const fieldValues: RecordValue = isRecord(data.fields) ? data.fields : data
	const formattedFields: RecordValue = { ...fieldValues }
	for (const [key, field] of Object.entries(form.fields ?? {})) {
		if (Object.prototype.hasOwnProperty.call(fieldValues, key) || options?.progressive) {
			formattedFields[key] = formatFieldValue(formatter, field, fieldValues[key], `fields.${key}`, options)
		}
	}
	if (nestedFields) result.fields = formattedFields
	else Object.assign(result, formattedFields)

	if (Object.prototype.hasOwnProperty.call(data, 'parties') || (options?.progressive && form.parties)) {
		const parties = data.parties
		if (!isMissing(parties) && !isRecord(parties)) throw formatIssue('parties', 'party', 'invalid_value', 'Expected parties to be an object.')
		const partyValues: RecordValue = isRecord(parties) ? parties : {}
		const formattedParties: RecordValue = { ...partyValues }
		for (const [role, value] of Object.entries(partyValues)) {
			if (!form.parties?.[role]) throw formatIssue(`parties.${role}`, 'party', 'unknown_path', `Unknown party role ${JSON.stringify(role)}.`)
			formattedParties[role] = formatParties(formatter, form, value, `parties.${role}`, options, role)
		}
		for (const role of Object.keys(form.parties ?? {})) {
			if (!Object.prototype.hasOwnProperty.call(formattedParties, role) && options?.progressive) {
				formattedParties[role] = formatParties(formatter, form, undefined, `parties.${role}`, options, role)
			}
		}
		result.parties = formattedParties
	}

	if (Object.prototype.hasOwnProperty.call(data, 'defs')) result.defs = formatDefs(formatter, form.defs, data.defs, options)
	if (Object.prototype.hasOwnProperty.call(data, 'defs') === false && options?.progressive && form.defs) {
		result.defs = formatDefs(formatter, form.defs, {}, options)
	}
	if (Object.prototype.hasOwnProperty.call(data, 'annexes') || (options?.progressive && form.annexes)) {
		result.annexes = formatAnnexes(formatter, form, data.annexes, options)
	}
	return result
}

/**
 * The value at one render-data path, formatted as {@link formatFieldData}
 * would format it, reading and formatting only what the path reaches. A
 * binding that is formatted on its own uses this, so a value no binding
 * reads is never formatted and cannot fail the render.
 *
 * A path to a declared field, party, computed value or annex gives its
 * formatted value; a member of a structured value gives its raw member, as
 * the preprocessed record does; anything else gives the raw value.
 */
export function formatValueAt(
	data: RecordValue,
	form: Form,
	formatter: Formatter,
	source: string,
	options?: FieldFormattingOptions,
): unknown {
	const path = renderDataPath(data, source)
	const segments = pathSegments(path)
	const [root, ...rest] = segments
	if (root === undefined) return undefined
	if (root === 'parties') return partyAt(formatter, form, data.parties, rest, options)
	if (root === 'defs') return definitionAt(formatter, form, data.defs, rest, options)
	if (root === 'annexes') return annexAt(formatter, form, data.annexes, rest, options)
	const nested = isRecord(data.fields)
	if (nested && root !== 'fields') return getPath(data, path)
	const fieldValues: RecordValue = nested ? data.fields as RecordValue : data
	const [key, ...members] = nested ? rest : segments
	const field = key === undefined ? undefined : form.fields?.[key]
	if (key === undefined || !field) return key === undefined ? undefined : getPath(fieldValues, [key, ...members].join('.'))
	if (!Object.prototype.hasOwnProperty.call(fieldValues, key) && !options?.progressive) return undefined
	return fieldAt(formatter, field, fieldValues[key], `fields.${key}`, members, options)
}

function rawAt(value: unknown, segments: readonly string[]): unknown {
	return segments.length === 0 ? value : getPath(value, segments.join('.'))
}

function fieldAt(
	formatter: Formatter,
	field: FormField,
	value: unknown,
	path: string,
	segments: readonly string[],
	options?: FieldFormattingOptions,
): unknown {
	if (segments.length === 0) return formatFieldValue(formatter, field, value, path, options)
	const [segment, ...rest] = segments as [string, ...string[]]
	if (field.type === 'list') {
		if (isMissing(value)) return undefined
		if (!Array.isArray(value)) throw formatIssue(path, field.type, 'invalid_value', 'Expected an array for a list field.')
		if (!isIndex(segment)) return rawAt(value, segments)
		const index = Number(segment)
		if (index >= value.length) return undefined
		return fieldAt(formatter, field.item, value[index], childPath(path, index), rest, options)
	}
	if (field.type === 'fieldset') {
		if (isMissing(value)) return undefined
		if (!isRecord(value)) throw formatIssue(path, field.type, 'invalid_value', 'Expected an object for a fieldset.')
		const child = Object.prototype.hasOwnProperty.call(field.fields, segment) ? field.fields[segment] : undefined
		if (!child) return rawAt(value, segments)
		if (!Object.prototype.hasOwnProperty.call(value, segment) && !options?.progressive) return undefined
		return fieldAt(formatter, child, value[segment], childPath(path, segment), rest, options)
	}
	if (field.type === 'phone' && segments.length === 1 && segment === 'number') return phoneNumberAt(formatter, value, path, options)
	if (field.type === 'address' && rest.length === 0) {
		const text = guardFormatting(path, field.type, () => addressMemberText(formatter, value, path, segment, options))
		if (text !== undefined) return cased(formatter, text, text, 'member', options)
	}
	return casedMember(formatter, rawAt(value, segments), options)
}

function casedMember(formatter: Formatter, member: unknown, options?: FieldFormattingOptions): unknown {
	return typeof member === 'string' ? cased(formatter, member, member, 'member', options) : member
}

function phoneNumberAt(formatter: Formatter, value: unknown, path: string, options?: FieldFormattingOptions): unknown {
	const number = rawAt(value, ['number'])
	const style = options?.phone?.style
	if (style === undefined || style === 'e164' || isMissing(number)) return number
	const memberPath = childPath(path, 'number')
	return callFormatter(memberPath, 'phone', number, () => formatter.safeFormatPhone(stringInput(number, memberPath, 'phone'), options?.phone), options)
}

function partyAt(formatter: Formatter, form: Form, parties: unknown, segments: readonly string[], options?: FieldFormattingOptions): unknown {
	if (isMissing(parties)) return undefined
	if (!isRecord(parties)) throw formatIssue('parties', 'party', 'invalid_value', 'Expected parties to be an object.')
	const [role, ...rest] = segments
	if (role === undefined) return undefined
	const value = parties[role]
	if (!form.parties?.[role]) return rawAt(value, rest)
	const path = `parties.${role}`
	if (rest.length === 0) {
		if (!Object.prototype.hasOwnProperty.call(parties, role) && !options?.progressive) return undefined
		return formatParties(formatter, form, value, path, options, role)
	}
	const [first, ...members] = rest as [string, ...string[]]
	if (Array.isArray(value) && isIndex(first)) {
		const index = Number(first)
		if (index >= value.length) return undefined
		return members.length === 0
			? formatParties(formatter, form, value[index], childPath(path, index), options, role)
			: casedMember(formatter, rawAt(value[index], members), options)
	}
	return casedMember(formatter, rawAt(value, rest), options)
}

function definitionAt(formatter: Formatter, form: Form, values: unknown, segments: readonly string[], options?: FieldFormattingOptions): unknown {
	if (isMissing(values)) return undefined
	if (!isRecord(values)) throw formatIssue('defs', 'computed', 'invalid_value', 'Expected computed values to be an object.')
	const [key, ...rest] = segments
	if (key === undefined) return undefined
	const definition = form.defs?.[key]
	if (!definition || rest.length > 0) return rawAt(values[key], rest)
	if (!Object.prototype.hasOwnProperty.call(values, key) && !options?.progressive) return undefined
	return formatDefinitionValue(formatter, definition.type, values[key], `defs.${key}`, options)
}

function annexAt(formatter: Formatter, form: Form, values: unknown, segments: readonly string[], options?: FieldFormattingOptions): unknown {
	if (isMissing(values)) return undefined
	if (!isRecord(values)) throw formatIssue('annexes', 'attachment', 'invalid_value', 'Expected annexes to be an object.')
	const [key, ...rest] = segments
	if (key === undefined) return undefined
	const value = values[key]
	if (rest.length > 0) return rawAt(value, rest)
	if (!Object.prototype.hasOwnProperty.call(values, key) && !(options?.progressive && form.annexes?.[key])) return undefined
	const path = `annexes.${key}`
	if (!form.annexes?.[key] && !form.allowAdditionalAnnexes) throw formatIssue(path, 'attachment', 'unknown_path', `Unknown annex ${JSON.stringify(key)}.`)
	return formatAttachmentValue(formatter, value, path, options)
}

/** Roots fill data carries beside field values when the request has them: see `flattenRenderData`. */
const signingRoots = new Set(['_signers', '_captures'])

function isIndex(segment: string): boolean {
	return /^\d+$/.test(segment) && Number.isSafeInteger(Number(segment))
}

const anyPath = Symbol('any-path')
interface PathObjectNode {
	readonly [segment: string]: PathNode
}

type PathNode = PathObjectNode | typeof anyPath

const leafPath: PathNode = Object.freeze({})
const blockedPathSegments = new Set(['__proto__', 'prototype', 'constructor'])

function objectPath(entries: Record<string, PathNode>): PathNode {
	return Object.freeze(entries)
}

function mergePaths(...nodes: PathNode[]): PathNode {
	if (nodes.some((node) => node === anyPath)) return anyPath
	return objectPath(Object.assign({}, ...nodes))
}

const moneyPath = objectPath({ amount: leafPath, currency: leafPath })
const addressPath = objectPath({
	line1: leafPath,
	line2: leafPath,
	locality: leafPath,
	region: leafPath,
	postalCode: leafPath,
	country: leafPath,
})
const phonePath = objectPath({ number: leafPath, type: leafPath, extension: leafPath })
const personPath = objectPath({ name: leafPath, title: leafPath, firstName: leafPath, middleName: leafPath, lastName: leafPath, suffix: leafPath })
const organizationPath = objectPath({
	name: leafPath,
	legalName: leafPath,
	domicile: leafPath,
	entityType: leafPath,
	entityId: leafPath,
	taxId: leafPath,
})
const coordinatePath = objectPath({ lat: leafPath, lon: leafPath })
const bboxPath = objectPath({
	southWest: coordinatePath,
	northEast: coordinatePath,
})
const identificationPath = objectPath({
	type: leafPath,
	number: leafPath,
	issuer: leafPath,
	issueDate: leafPath,
	expiryDate: leafPath,
})
const attachmentPath = objectPath({ name: leafPath, mimeType: leafPath, checksum: leafPath })
const signaturePath = objectPath({ image: leafPath, timestamp: leafPath, method: leafPath, type: leafPath, metadata: anyPath })
const signerPath = objectPath({
	signerId: leafPath,
	capacity: leafPath,
	_role: leafPath,
	_partyId: leafPath,
	id: leafPath,
	signer: objectPath({
		id: leafPath,
		person: personPath,
		adopted: objectPath({ signature: signaturePath, initials: signaturePath }),
	}),
})
const partyRuntimePath = objectPath({
	id: leafPath,
	_role: leafPath,
	signatories: objectPath({ '#': signerPath }),
	_captures: anyPath,
	_signers: anyPath,
})

const pathNodesByType: Readonly<Record<string, PathNode>> = {
	money: moneyPath,
	address: addressPath,
	country: leafPath,
	region: leafPath,
	phone: phonePath,
	person: personPath,
	organization: organizationPath,
	party: mergePaths(personPath, organizationPath, partyRuntimePath),
	coordinate: coordinatePath,
	bbox: bboxPath,
	identification: identificationPath,
	attachment: attachmentPath,
	signature: signaturePath,
	string: leafPath,
	text: leafPath,
	email: leafPath,
	uuid: leafPath,
	uri: leafPath,
	duration: leafPath,
	date: leafPath,
	datetime: leafPath,
	time: leafPath,
	number: leafPath,
	integer: leafPath,
	percentage: leafPath,
	rating: leafPath,
	boolean: leafPath,
	enum: leafPath,
	multiselect: leafPath,
}

function pathNodeForType(type: string): PathNode | undefined {
	return pathNodesByType[type]
}

function hasOwn(value: unknown, key: string): boolean {
	return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
}

function validatePathSyntax(path: string): boolean {
	if (!path || path.startsWith('.') || path.endsWith('.') || path.includes('..')) return false
	return path.split('.').every((segment) => /^[^.[\]]+(?:\[\d+\])*$/.test(segment))
}

function validatePathNode(node: PathNode, segments: readonly string[], index: number, path: string, fieldType: string): void {
	if (index >= segments.length || node === anyPath) return
	const segment = segments[index]!
	if (blockedPathSegments.has(segment)) {
		throw formatIssue(path, fieldType, 'unknown_path', `Blocked path segment ${JSON.stringify(segment)}.`)
	}

	let child: PathNode | undefined
	if (Object.prototype.hasOwnProperty.call(node, segment)) {
		child = node[segment]
	} else if (Object.prototype.hasOwnProperty.call(node, '#')) {
		if (!isIndex(segment)) {
			throw formatIssue(path, fieldType, 'unknown_path', `Expected a safe numeric index before ${JSON.stringify(segment)}.`)
		}
		child = node['#']
	} else if (Object.prototype.hasOwnProperty.call(node, '*')) {
		child = node['*']
	}

	if (!child) {
		throw formatIssue(path, fieldType, 'unknown_path', `Unknown ${fieldType} member ${JSON.stringify(segment)}.`)
	}
	validatePathNode(child, segments, index + 1, path, fieldType)
}

function validateDeclaredField(field: FormField, segments: readonly string[], index: number, path: string): void {
	if (index >= segments.length) return
	const segment = segments[index]!
	if (field.type === 'list') {
		if (!isIndex(segment)) throw formatIssue(path, field.type, 'unknown_path', `Expected a list index before ${JSON.stringify(segment)}.`)
		return validateDeclaredField(field.item, segments, index + 1, path)
	}
	if (field.type === 'fieldset') {
		const child = hasOwn(field.fields, segment) ? field.fields[segment] : undefined
		if (!child) throw formatIssue(path, field.type, 'unknown_path', `Unknown nested field ${JSON.stringify(segment)}.`)
		return validateDeclaredField(child, segments, index + 1, path)
	}
	const node = pathNodeForType(field.type)
	if (!node) throw formatIssue(path, field.type, 'unsupported_path', `Unsupported field type ${JSON.stringify(field.type)}.`)
	validatePathNode(node, segments, index, path, field.type)
}

function validatePartyPath(form: Form, segments: readonly string[], path: string): void {
	const role = segments[0]
	const definition = role && hasOwn(form.parties, role) ? form.parties?.[role] : undefined
	if (!role || !definition) throw formatIssue(path, 'party', 'unknown_path', `Unknown party role ${JSON.stringify(role)}.`)
	if (segments.length === 1) return

	const max = definition.max ?? 1
	const segment = segments[1]!
	const indexed = isIndex(segment)
	const isCollection = max > 1
	if (indexed) {
		if (!isCollection) throw formatIssue(path, 'party', 'unknown_path', `Party role ${JSON.stringify(role)} does not accept an index.`)
		if (Number(segment) >= max) throw formatIssue(path, 'party', 'unknown_path', `Party index ${segment} is outside the declared maximum of ${max}.`)
		if (segments.length === 2) return
		validatePathNode(partyPathNode(definition.partyType), segments, 2, path, 'party')
		return
	}
	if (isCollection) throw formatIssue(path, 'party', 'unknown_path', `Party role ${JSON.stringify(role)} requires an index.`)
	validatePathNode(partyPathNode(definition.partyType), segments, 1, path, 'party')
}

function partyPathNode(partyType: string | undefined): PathNode {
	const identity = partyType === 'person'
		? personPath
		: partyType === 'organization'
			? organizationPath
			: mergePaths(personPath, organizationPath)
	return mergePaths(identity, partyRuntimePath)
}

function validateBindingPath(form: Form, sourcePath: string, bindingKey: string): void {
	const path = bindingDataPath(sourcePath)
	if (!validatePathSyntax(path)) throw formatIssue(`bindings.${bindingKey}`, 'path', 'unknown_path', `Malformed field path ${JSON.stringify(sourcePath)}.`)
	const segments = pathSegments(path)
	if (segments.length === 0) throw formatIssue(`bindings.${bindingKey}`, 'path', 'unknown_path', `Unknown field path ${JSON.stringify(sourcePath)}.`)
	const root = segments[0]!
	if (root === 'parties') {
		validatePartyPath(form, segments.slice(1), sourcePath)
		return
	}
	if (root === 'defs') {
		const definitionKey = segments[1]
		const definition = definitionKey && hasOwn(form.defs, definitionKey) ? form.defs?.[definitionKey] : undefined
		if (!definition) throw formatIssue(sourcePath, 'computed', 'unknown_path', `Unknown computed value ${JSON.stringify(definitionKey)}.`)
		if (segments.length > 2) {
			const node = pathNodeForType(definition.type)
			if (!node) throw formatIssue(sourcePath, 'computed', 'unsupported_path', `Unsupported computed value type ${JSON.stringify(definition.type)}.`)
			validatePathNode(node, segments, 2, sourcePath, definition.type)
		}
		return
	}
	if (root === 'annexes') {
		const annex = segments[1]
		if (!annex || (!hasOwn(form.annexes, annex) && !form.allowAdditionalAnnexes)) {
			throw formatIssue(sourcePath, 'attachment', 'unknown_path', `Unknown annex ${JSON.stringify(annex)}.`)
		}
		if (segments.length > 2) validatePathNode(attachmentPath, segments, 2, sourcePath, 'attachment')
		return
	}
	const field = form.fields?.[root]
	if (field) {
		validateDeclaredField(field, segments, 1, sourcePath)
		return
	}
	if (signingRoots.has(root)) return
	throw formatIssue(sourcePath, 'path', 'unknown_path', `Unknown field path ${JSON.stringify(sourcePath)}.`)
}

/**
 * Validate the paths renderer bindings read against the declared artifact
 * shape. Each value is one path a binding reads, such as `fields.name`, keyed
 * by a label errors name it by.
 */
export function validateFieldBindings(form: Form, sources: Readonly<Record<string, string>>): void {
	for (const [bindingKey, sourcePath] of Object.entries(sources)) {
		validateBindingPath(form, sourcePath, bindingKey)
	}
}
