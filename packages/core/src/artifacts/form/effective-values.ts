import type { Form, FormField } from '@asterdoc/types'
import { evaluateFormDefs } from '@/logic/runtime/evaluation/form-evaluator'
import type { FormDataPayload } from '@/logic/runtime/evaluation/context-builder'
import type { FieldRuntimeState } from '@/logic/runtime/evaluation/types'
import { canonicalizeFieldValue } from '@/validation/canonicalize'
import { deepClone } from '@/utils/clone'

export interface EffectiveFieldValues {
	readonly fields: Record<string, unknown>
	readonly stored: Record<string, unknown>
	readonly defaulted: readonly string[]
}

interface DefaultedValues {
	readonly fields: Record<string, unknown>
	readonly defaulted: readonly string[]
}

export type EffectiveValuesScope = Omit<FormDataPayload, 'fields'>

type FieldStates = ReadonlyMap<string, FieldRuntimeState> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function defaultOf(field: FormField): unknown {
	const value = deepClone((field as { default?: unknown }).default)
	const canonical = canonicalizeFieldValue(field, value, { mode: 'progressive' })
	return canonical.success ? canonical.value : value
}

function fieldStatesOf(form: Form, fields: Record<string, unknown>, scope: EffectiveValuesScope): FieldStates {
	const result = evaluateFormDefs(form, { ...scope, fields })
	return 'value' in result ? result.value.fields : undefined
}

function withDefaults(
	form: Form,
	given: Record<string, unknown>,
	states: FieldStates,
): DefaultedValues {
	const defaulted: string[] = []
	const applies = (key: string): boolean => states?.get(key)?.visible !== false

	const fillFields = (
		fields: Readonly<Record<string, FormField>>,
		values: Record<string, unknown> | undefined,
		prefix: string,
	): Record<string, unknown> => {
		const result: Record<string, unknown> = { ...values }
		for (const [id, field] of Object.entries(fields)) {
			const key = prefix ? `${prefix}.${id}` : id
			if (!applies(key)) continue
			const filled = fillValue(field, result[id], key)
			if (filled !== undefined) result[id] = filled
		}
		return result
	}

	const fillValue = (field: FormField, value: unknown, key: string): unknown => {
		if (value === undefined) {
			if ((field as { default?: unknown }).default !== undefined) {
				defaulted.push(key)
				return defaultOf(field)
			}
			if (field.type !== 'fieldset') return undefined
			const inner = fillFields(field.fields, undefined, key)
			return Object.keys(inner).length > 0 ? inner : undefined
		}
		if (field.type === 'fieldset' && isRecord(value)) return fillFields(field.fields, value, key)
		if (field.type === 'list' && Array.isArray(value)) {
			return value.map((row, index) => {
				const rowKey = `${key}[${index}]`
				return row === undefined || !applies(rowKey) ? row : fillValue(field.item, row, rowKey)
			})
		}
		return value
	}

	return { fields: fillFields(form.fields ?? {}, deepClone(given), ''), defaulted }
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((key, index) => key === right[index])
}

function defaultSiteCount(fields: Readonly<Record<string, FormField>>, values: unknown): number {
	const record = isRecord(values) ? values : {}
	return Object.entries(fields).reduce((count, [id, field]) => count + fieldSiteCount(field, record[id]), 0)
}

function fieldSiteCount(field: FormField, value: unknown): number {
	const own = (field as { default?: unknown }).default !== undefined ? 1 : 0
	if (field.type === 'fieldset') return own + defaultSiteCount(field.fields, value)
	if (field.type === 'list' && Array.isArray(value)) return own + value.reduce<number>((count, row) => count + fieldSiteCount(field.item, row), 0)
	return own
}

export function effectiveFieldValues(
	form: Form,
	given: Record<string, unknown>,
	scope: EffectiveValuesScope,
): EffectiveFieldValues {
	const rounds = defaultSiteCount(form.fields ?? {}, given) + 1
	let current = withDefaults(form, given, fieldStatesOf(form, withoutEmpties(given), scope))
	for (let round = 0; round < rounds; round += 1) {
		const next = withDefaults(form, given, fieldStatesOf(form, withoutEmpties(current.fields), scope))
		if (sameKeys(next.defaulted, current.defaulted)) {
			return { fields: withoutEmpties(current.fields), stored: current.fields, defaulted: current.defaulted }
		}
		current = next
	}
	throw new Error(`The defaults of form "${form.name}" do not settle in ${rounds} rounds: a default decides whether its own field is visible.`)
}

function keySegments(key: string): Array<string | number> {
	return (key.match(/[^.[\]]+/g) ?? []).map((token) => (/^\d+$/.test(token) ? Number(token) : token))
}

function withoutKey(value: unknown, segments: ReadonlyArray<string | number>): unknown {
	const [head, ...rest] = segments
	if (head === undefined) return undefined
	if (Array.isArray(value) && typeof head === 'number') {
		return value.map((row, index) => (index === head ? withoutKey(row, rest) ?? row : row))
	}
	if (!isRecord(value) || typeof head !== 'string' || !(head in value)) return value
	const result = { ...value }
	if (rest.length === 0) {
		delete result[head]
	} else {
		const inner = withoutKey(result[head], rest)
		if (isRecord(inner) && Object.keys(inner).length === 0 && isRecord(result[head])) delete result[head]
		else result[head] = inner
	}
	return result
}
export function givenFieldValues(fields: Record<string, unknown>, defaulted: readonly string[]): Record<string, unknown> {
	return defaulted.reduce<Record<string, unknown>>(
		(values, key) => withoutKey(values, keySegments(key)) as Record<string, unknown>,
		fields,
	)
}

function stripEmpties(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripEmpties)
	if (!isRecord(value)) return value
	const result: Record<string, unknown> = {}
	for (const [key, entry] of Object.entries(value)) {
		if (entry === null) continue
		const inner = stripEmpties(entry)
		if (isRecord(entry) && Object.keys(entry).length > 0 && isRecord(inner) && Object.keys(inner).length === 0) continue
		result[key] = inner
	}
	return result
}
export function withoutEmpties(fields: Record<string, unknown>): Record<string, unknown> {
	return stripEmpties(fields) as Record<string, unknown>
}
export function emptyKeys(value: unknown, prefix = ''): string[] {
	if (Array.isArray(value)) return value.flatMap((row, index) => emptyKeys(row, `${prefix}[${index}]`))
	if (!isRecord(value)) return []
	return Object.entries(value).flatMap(([key, entry]) => {
		const path = prefix ? `${prefix}.${key}` : key
		return entry === null ? [path] : emptyKeys(entry, path)
	})
}

function withEmptyAt(value: unknown, segments: ReadonlyArray<string | number>): unknown {
	const [head, ...rest] = segments
	if (head === undefined) return value
	if (typeof head === 'number') {
		if (!Array.isArray(value) || head >= value.length || rest.length === 0) return value
		return value.map((row, index) => (index === head ? withEmptyAt(row, rest) : row))
	}
	if (value !== undefined && !isRecord(value)) return value
	const result: Record<string, unknown> = { ...value }
	const inner = rest.length === 0 ? null : withEmptyAt(result[head] === null ? undefined : result[head], rest)
	if (inner === undefined) return value
	result[head] = inner
	return result
}
export function withEmpties(fields: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
	return keys.reduce<Record<string, unknown>>(
		(values, key) => withEmptyAt(values, keySegments(key)) as Record<string, unknown>,
		fields,
	)
}
