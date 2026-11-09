import type { StandardSchemaV1 } from '@standard-schema/spec'
import { findSubdivision, isCountryCode, resolveAddressRegion, resolveCountry, resolveRegion, type PlaceOutcome } from '@asterdoc/format'
import { regionsProvider as regions } from '@asterdoc/format/regions'
import type { Form, FormField, LayerFormat } from '@asterdoc/types'
import type { LayerValidationIssue } from './pdf-layers'
import { canonicalizeFieldValue } from './canonicalize'

type Path = (string | number)[]

function visit(field: FormField, path: Path, issues: StandardSchemaV1.Issue[]): void {
	switch (field.type) {
		case 'country':
			if (field.default !== undefined && !isCountryCode(field.default)) {
				issues.push({ path: [...path, 'default'], message: `Default ${JSON.stringify(field.default)} is not an ISO 3166-1 alpha-2 country code.` })
			}
			return
		case 'region': {
			if (field.country !== undefined && !isCountryCode(field.country)) {
				issues.push({ path: [...path, 'country'], message: `${JSON.stringify(field.country)} is not an ISO 3166-1 alpha-2 country code.` })
			}
			if (field.default === undefined) return
			const subdivision = findSubdivision(field.default, regions)
			if (!subdivision) {
				issues.push({ path: [...path, 'default'], message: `Default ${JSON.stringify(field.default)} is not an ISO 3166-2 subdivision code.` })
			} else if (field.country !== undefined && subdivision.country !== field.country) {
				issues.push({ path: [...path, 'default'], message: `Default ${JSON.stringify(field.default)} is not a subdivision of ${field.country}.` })
			}
			return
		}
		case 'address': {
			if (field.codes !== true || field.default === undefined) return
			const result = canonicalizeFieldValue(field, field.default, { mode: 'complete' })
			if (!result.success) {
				for (const issue of result.issues) issues.push({ path: [...path, 'default', ...issue.path.split('.')], message: issue.message })
			} else if (JSON.stringify(result.value) !== JSON.stringify(field.default)) {
				issues.push({ path: [...path, 'default'], message: 'An address with codes: true stores its country and region as codes; write the default with them.' })
			}
			return
		}
		case 'fieldset':
			for (const [key, child] of Object.entries(field.fields)) visit(child, [...path, 'fields', key], issues)
			return
		case 'list':
			visit(field.item, [...path, 'item'], issues)
			return
		default:
			return
	}
}

/**
 * The country and region codes a form's field definitions state: a region's
 * `country` constraint and the defaults of `country`, `region` and
 * `codes: true` address fields must be codes in the shipped lists.
 */
export function validatePlaceDefinitions(form: Form): StandardSchemaV1.Issue[] {
	const issues: StandardSchemaV1.Issue[] = []
	for (const [key, field] of Object.entries(form.fields ?? {})) visit(field, ['fields', key], issues)
	return issues
}

type PlaceFormat = { country: boolean; region: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function layerPlaceFormat(layer: { format?: LayerFormat; bindings?: Record<string, unknown> }): PlaceFormat {
	const formats = [layer.format, ...Object.values(layer.bindings ?? {}).map((binding) => isRecord(binding) ? binding.format as LayerFormat | undefined : undefined)]
	return {
		country: formats.some((format) => format?.country !== undefined),
		region: formats.some((format) => format?.region !== undefined),
	}
}

function storedProblems(field: FormField, value: unknown, path: Path, printed: PlaceFormat): { path: Path; message: string }[] {
	const failed = (at: Path, outcome: PlaceOutcome) => outcome.ok ? [] : [{ path: at, message: outcome.message }]
	if (value === undefined || value === null) return []
	switch (field.type) {
		case 'country':
			return printed.country && typeof value === 'string' ? failed(path, resolveCountry(value, { regions })) : []
		case 'region':
			return printed.region && typeof value === 'string' ? failed(path, resolveRegion(value, { ...(field.country !== undefined && { country: field.country }), regions })) : []
		case 'address': {
			if (!isRecord(value) || typeof value.country !== 'string') return []
			const country = resolveCountry(value.country, { regions })
			const problems = printed.country || printed.region ? failed([...path, 'country'], country) : []
			if (printed.region && country.ok && typeof value.region === 'string') problems.push(...failed([...path, 'region'], resolveAddressRegion(value.region, country.value, regions)))
			return problems
		}
		case 'fieldset':
			return isRecord(value) ? Object.entries(field.fields).flatMap(([key, child]) => storedProblems(child, value[key], [...path, key], printed)) : []
		case 'list':
			return Array.isArray(value) ? value.flatMap((item, index) => storedProblems(field.item, item, [...path, index], printed)) : []
		default:
			return []
	}
}

function defaultProblems(field: FormField, path: Path, printed: PlaceFormat): { path: Path; message: string }[] {
	const own = 'default' in field ? storedProblems(field, field.default, [...path, 'default'], printed) : []
	if (field.type === 'fieldset') return [...own, ...Object.entries(field.fields).flatMap(([key, child]) => defaultProblems(child, [...path, 'fields', key], printed))]
	if (field.type === 'list') return [...own, ...defaultProblems(field.item, [...path, 'item'], printed)]
	return own
}

/**
 * Warnings for a layer that prints countries or subdivisions as codes or
 * names over a value the artifact stores that does not normalize: such a
 * value fails the layer's render. The values an artifact stores are its
 * field defaults.
 */
export function validatePlaceFormats(form: Form): LayerValidationIssue[] {
	const issues: LayerValidationIssue[] = []
	for (const [key, layer] of Object.entries(form.layers ?? {})) {
		const printed = layerPlaceFormat(layer as { format?: LayerFormat; bindings?: Record<string, unknown> })
		if (!printed.country && !printed.region) continue
		for (const [id, field] of Object.entries(form.fields ?? {})) {
			for (const problem of defaultProblems(field, ['fields', id], printed)) {
				issues.push({
					message: `Layer "${key}" prints countries or subdivisions by code or name, and ${problem.path.join('.')} does not normalize, so the layer cannot render it: ${problem.message}`,
					path: problem.path,
					severity: 'warning',
				})
			}
		}
	}
	return issues
}
