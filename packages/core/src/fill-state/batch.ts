import type { Form, FormField } from '@asterdoc/types'
import { describeCompositeShape } from '@/inference/composite-shapes'
import { fieldAtSegments } from '@/logic/shared/sensitive-values'
import { ORGANIZATION_MEMBERS } from '@/primitives/party'
import { fieldInputGuidance } from '@/validation/input-guidance'
import { notApplicableProblems } from './engine'
import { printedPartyMembers, unprintedNameProblems } from './printed-names'
import type { FillBatch, FillBatchOption, FillBatchTarget, FillItemState, FillState } from './types'

function segmentsOf(key: string): string[] {
	return key.replace(/\[(\d+)\]/g, '.$1').split('.').filter((segment) => segment !== '')
}

function optionsOf(field: FormField): FillBatchOption[] | undefined {
	const source = (field as { enum?: unknown }).enum ?? (field.type === 'multiselect' || field.type === 'list' ? ((field as { item?: { enum?: unknown } }).item?.enum) : undefined)
	if (!Array.isArray(source)) return undefined
	return source.flatMap((entry): FillBatchOption[] => {
		if (entry !== null && typeof entry === 'object' && 'value' in entry) {
			const { value, label } = entry as { value: FillBatchOption['value']; label?: unknown }
			return [{ value, ...(typeof label === 'string' ? { label } : {}) }]
		}
		return typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' ? [{ value: entry }] : []
	})
}

const CONSTRAINT_KEYS = ['min', 'max', 'step', 'precision', 'minLength', 'maxLength', 'pattern', 'mask', 'minItems', 'maxItems', 'currency', 'country'] as const

const FORMATS: Record<string, string> = {
	date: 'YYYY-MM-DD',
	datetime: 'ISO 8601 date and time with Z or a ±HH:MM offset, such as 2026-11-11T14:30:00Z',
	time: 'HH:MM:SS',
}

function constraintsOf(field: FormField): Record<string, string | number | boolean> | undefined {
	const definition = field as unknown as Record<string, unknown>
	const found = CONSTRAINT_KEYS.flatMap((key): Array<[string, string | number | boolean]> => {
		const value = definition[key]
		return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [[key, value]] : []
	})
	return found.length === 0 ? undefined : Object.fromEntries(found)
}

function hasCondition(definition: unknown): boolean {
	const visible = (definition as { visible?: unknown } | undefined)?.visible
	return visible !== undefined && visible !== true
}

type FieldDetails = Omit<FillBatchTarget, 'kind' | 'key' | 'required' | 'conditional'>

function rowFields(item: FormField | undefined, prefix = ''): FillBatchTarget[] {
	if (item?.type !== 'fieldset') return []
	return Object.entries(item.fields).flatMap(([name, member]): FillBatchTarget[] => {
		const key = `${prefix}${name}`
		if (member.type === 'fieldset') return rowFields(member, `${key}.`)
		return [{ kind: 'field', key, required: member.required === true, ...(hasCondition(member) ? { conditional: true } : {}), ...fieldDetails(member) }]
	})
}

function fieldDetails(field: FormField): FieldDetails {
	const shape = describeCompositeShape(field.type)
	const input = fieldInputGuidance(field)
	const options = optionsOf(field)
	const constraints = constraintsOf(field)
	const format = FORMATS[field.type]
	const row = field.type === 'list' ? field.item : undefined
	const rows = rowFields(row)
	return {
		type: field.type,
		...(typeof field.label === 'string' ? { label: field.label } : {}),
		...(typeof field.description === 'string' ? { description: field.description } : {}),
		...(shape !== null ? { shape } : {}),
		...(input !== undefined ? { input } : {}),
		...(options !== undefined ? { options } : {}),
		...(format !== undefined ? { format } : {}),
		...(constraints !== undefined ? { constraints } : {}),
		...(typeof row?.type === 'string' ? { item: row.type } : {}),
		...(rows.length > 0 ? { rows } : {}),
	}
}

function fieldTarget(form: Form, item: FillItemState): FillBatchTarget {
	const segments = segmentsOf(item.key)
	const conditional = segments.some((_, index) => hasCondition(fieldAtSegments(form.fields ?? {}, segments.slice(0, index + 1))))
	const base: FillBatchTarget = { kind: 'field', key: item.key, required: item.required, ...(conditional ? { conditional } : {}) }
	const field = fieldAtSegments(form.fields ?? {}, segments)
	return field === undefined ? base : { ...base, ...fieldDetails(field) }
}

const EITHER_KIND = `The members say which kind the party is. For an organization give \`legalName\` next to \`name\`, with the text of \`name\` when it has no other registered name. A party with none of ${ORGANIZATION_MEMBERS.slice(0, -1).join(', ')} and ${ORGANIZATION_MEMBERS[ORGANIZATION_MEMBERS.length - 1]!} is read as a person.`

function partyTarget(form: Form, item: FillItemState): FillBatchTarget {
	const party = form.parties?.[item.key]
	const either = party?.partyType === 'any'
	const kinds = either ? ['person', 'organization'] : [party?.partyType === 'organization' ? 'organization' : 'person']
	const shapes = kinds.flatMap((kind) => describeCompositeShape(kind) ?? [])
	const prints = printedPartyMembers(form, item.key)
	const max = party?.max ?? 1
	return {
		kind: 'party',
		key: item.key,
		required: item.required,
		type: party?.partyType ?? 'person',
		...(typeof party?.label === 'string' ? { label: party.label } : {}),
		...(typeof party?.description === 'string' ? { description: party.description } : {}),
		...(shapes.length > 0 ? { shape: shapes.join(' or ') } : {}),
		...(either ? { input: EITHER_KIND } : {}),
		...(prints.length > 0 ? { prints } : {}),
		...(max > 1 ? { item: kinds.join(' or '), constraints: { maxItems: max } } : {}),
	}
}

function annexTarget(form: Form, item: FillItemState): FillBatchTarget {
	const annex = (form.annexes as Record<string, { title?: unknown; label?: unknown; description?: unknown }> | undefined)?.[item.key]
	const label = annex?.title ?? annex?.label
	return {
		kind: 'annex',
		key: item.key,
		required: item.required,
		...(typeof label === 'string' ? { label } : {}),
		...(typeof annex?.description === 'string' ? { description: annex.description } : {}),
		...(hasCondition(annex) ? { conditional: true } : {}),
	}
}

function targetOf(form: Form, item: FillItemState): FillBatchTarget {
	if (item.kind === 'party') return partyTarget(form, item)
	if (item.kind === 'annex') return annexTarget(form, item)
	return fieldTarget(form, item)
}

/**
 * Describes every target that is open now, so a filler can supply them in one
 * batch: the visible, unfilled fields, parties and annexes, required first in
 * dependency order, each with its label, type, value shape, input note and
 * options. Targets hidden behind an unfilled answer are counted in `waiting`;
 * they open in the batch after that answer. A value given for a target that
 * does not apply is listed in `notApplicable`, and a party whose name a PDF
 * layer does not print in `unprintedNames`. `complete` means no required
 * target is open, every rule passes, every value given applies and every
 * party's name prints; optional targets may still be open.
 */
export function fillBatch(form: Form, state: FillState): FillBatch {
	const open = [...state.openRequired, ...state.openOptional].map((item) => targetOf(form, item))
	const openKeys = new Set(open.map((target) => target.key))
	const blockers = [...new Set(state.blocked.flatMap((item) => item.blockedBy))].filter((key) => openKeys.has(key))
	const errors = state.rules.errors.map((result) => ({ ruleId: result.ruleId, message: result.message ?? `Rule ${result.ruleId} failed`, ...(result.paths ? { paths: [...result.paths] } : {}) }))
	const warnings = state.rules.warnings.map((result) => ({ ruleId: result.ruleId, message: result.message ?? `Rule ${result.ruleId} warns`, ...(result.paths ? { paths: [...result.paths] } : {}) }))
	const issues = state.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
	const notApplicable = notApplicableProblems(state)
	const unprintedNames = unprintedNameProblems(state)
	return {
		complete: state.summary.requiredRemaining === 0 && errors.length === 0 && issues.length === 0 && notApplicable.length === 0 && unprintedNames.length === 0,
		summary: { ...state.summary },
		open,
		waiting: { count: state.blocked.length, on: blockers },
		rules: { errors, warnings },
		issues,
		notApplicable,
		unprintedNames,
	}
}
