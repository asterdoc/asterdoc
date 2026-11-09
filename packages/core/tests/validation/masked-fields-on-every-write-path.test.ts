import { describe, expect, it } from 'vitest'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { a } from '@/artifacts'
import { canonicalizeFieldValue, runtimeFormFromJSON, validate, validateLayers, FormValidationError } from '@/index'

const definition = {
	kind: 'form' as const,
	name: 'masked',
	version: '1.0.0',
	fields: {
		ssn: { type: 'text' as const, label: 'SSN', mask: '###-##-####', pattern: '^[0-8]\\d{8}$' },
		code: { type: 'text' as const, label: 'Code', mask: 'A-@@' },
		ein: { type: 'text' as const, label: 'EIN', mask: '##-#######', default: '12-3456789' },
		note: { type: 'text' as const, label: 'Note', maxLength: 3 },
		people: {
			type: 'list' as const,
			label: 'People',
			item: { type: 'fieldset' as const, fields: { anumber: { type: 'text' as const, label: 'A-Number', mask: 'A-#########' } } },
		},
	},
}

const form = () => a.form(definition)
const thrown = (run: () => unknown): unknown => {
	try {
		run()
	} catch (error) {
		return error
	}
	return undefined
}

describe('canonicalizeFieldValue', () => {
	const ssn = definition.fields.ssn

	it('stores a masked value without its literals, through lists and fieldsets', () => {
		expect(canonicalizeFieldValue(ssn, '123-45-6789', { mode: 'complete' })).toEqual({ success: true, value: '123456789' })
		expect(canonicalizeFieldValue(ssn, '123456789', { mode: 'complete' })).toEqual({ success: true, value: '123456789' })
		expect(canonicalizeFieldValue(definition.fields.people, [{ anumber: 'A-012345678' }, { anumber: '987654321' }], { mode: 'complete' }))
			.toEqual({ success: true, value: [{ anumber: '012345678' }, { anumber: '987654321' }] })
	})

	it('passes values of unmasked fields through untouched', () => {
		expect(canonicalizeFieldValue(definition.fields.note, '1-2', { mode: 'complete' })).toEqual({ success: true, value: '1-2' })
		expect(canonicalizeFieldValue(ssn, 42, { mode: 'complete' })).toEqual({ success: true, value: 42 })
	})

	it('refuses a value that does not fit, naming the expected shape and path', () => {
		const result = canonicalizeFieldValue(definition.fields.people, [{ anumber: 'B-012345678' }], { mode: 'complete', path: 'fields.people' })
		expect(result).toEqual({ success: false, issues: [{ path: 'fields.people.0.anumber', code: 'mask_mismatch', candidates: [], message: expect.stringContaining('A-#########: 9 digits, written A-123456789 or 123456789') }] })
	})

	it('reads a prefix in the stated input form only in progressive mode', () => {
		expect(canonicalizeFieldValue(definition.fields.code, 'A', { mode: 'progressive' })).toEqual({ success: true, value: 'A' })
		expect(canonicalizeFieldValue(definition.fields.code, 'A', { mode: 'progressive', input: 'formatted' })).toEqual({ success: true, value: '' })
		expect(canonicalizeFieldValue(definition.fields.code, 'A-A', { mode: 'progressive', input: 'formatted' })).toEqual({ success: true, value: 'A' })
		expect(canonicalizeFieldValue(definition.fields.code, 'A', { mode: 'complete' }).success).toBe(false)
	})
})

describe('writing a masked field', () => {
	it('stores the canonical value from fill, update and safeUpdate, with or without separators', () => {
		const draft = form().fill({ fields: { ssn: '123-45-6789' } })
		expect(draft.getField('ssn')).toBe('123456789')
		expect(draft.update({ fields: { code: 'A-XY' } }).getField('code')).toBe('XY')
		const updated = draft.safeUpdate({ fields: { people: [{ anumber: 'A-012345678' }] } })
		expect(updated.success && updated.data.getField('people')).toEqual([{ anumber: '012345678' }])
	})

	it('stores a default without its literals', () => {
		expect(form().fill().getField('ein')).toBe('123456789')
		const changed = form().fill({ fields: { ein: '98-7654321' } })
		expect(changed.reset('fields.ein').getField('ein')).toBe('123456789')
	})

	it('refuses a value that does not fit with a structured mask_mismatch issue', () => {
		const error = thrown(() => form().fill().update({ fields: { ssn: '123-456-789' } }))
		expect(error).toBeInstanceOf(FormValidationError)
		expect((error as FormValidationError).errors).toEqual([expect.objectContaining({ field: 'fields.ssn', code: 'mask_mismatch' })])
		expect(form().fill().safeUpdate({ fields: { ssn: '12345678X' } }).success).toBe(false)
	})

	it('accepts a prefix while drafting and refuses it on completion', () => {
		const draft = form().fill({ fields: { ssn: '123' } })
		expect(draft.getField('ssn')).toBe('123')
		expect(draft.validate().errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'fields.ssn', code: 'mask_mismatch' })]))
		expect(form().safeParseData({ fields: { ssn: '123' } }).success).toBe(false)
		expect(form().safeParseData({ fields: { ssn: '123-45-6789' } })).toMatchObject({ success: true, data: { fields: { ssn: '123456789' } } })
	})

	it('applies pattern and maxLength to the canonical value, on completion only', () => {
		expect(form().fill({ fields: { ssn: '9' } }).getField('ssn')).toBe('9')
		expect(form().safeParseData({ fields: { ssn: '923-45-6789' } }).success).toBe(false)
		expect(form().safeParseData({ fields: { ssn: '823-45-6789' } }).success).toBe(true)
		expect(form().fill().safeUpdate({ fields: { note: '1234' } }).success).toBe(false)
	})

	it('validates one field input with the stated input form', () => {
		const instance = form()
		expect(instance.validateFieldInput({ fieldPath: 'ssn', value: '123-45-6789' })).toMatchObject({ success: true, value: '123456789' })
		expect(instance.validateFieldInput({ fieldPath: 'code', value: 'A' })).toMatchObject({ success: true, value: 'A' })
		expect(instance.validateFieldInput({ fieldPath: 'code', value: 'A-', input: 'formatted' })).toMatchObject({ success: true, value: '' })
		expect(instance.validateFieldInput({ fieldPath: 'people.0.anumber', value: 'A-012345678' })).toMatchObject({ success: true, value: '012345678' })
		expect(instance.validateFieldInput({ fieldPath: 'code', value: 'A-' })).toMatchObject({ success: false, errors: [expect.objectContaining({ code: 'mask_mismatch' })] })
		expect(instance.validateFieldsPatch({ ssn: '123-45-6789' })).toMatchObject({ success: true, value: { ssn: '123456789' } })
	})

	it('keeps stored values unchanged on restore and on repeated writes', () => {
		const draft = form().fill({ fields: { ssn: '123-45-6789', code: 'A' } })
		const restored = runtimeFormFromJSON(draft.toJSON())
		expect(restored.getField('ssn')).toBe('123456789')
		expect(restored.getField('code')).toBe('A')
		const again = (restored as typeof draft).update({ fields: { ssn: restored.getField('ssn') as string, code: restored.getField('code') as string } })
		expect([again.getField('ssn'), again.getField('code')]).toEqual(['123456789', 'A'])
	})

	it('canonicalizes stored values on restore and refuses one that does not fit', () => {
		const json = form().fill().toJSON()
		expect(runtimeFormFromJSON({ ...json, fields: { ...json.fields, ssn: '123-45-6789' } }).getField('ssn')).toBe('123456789')
		expect(() => runtimeFormFromJSON({ ...json, fields: { ...json.fields, ssn: '12-34' } })).toThrow(FormValidationError)
	})
})

describe('validating a masked artifact', () => {
	it('refuses a default that does not fit the mask', () => {
		const result = validate({ ...definition, fields: { ...definition.fields, ein: { ...definition.fields.ein, default: '123' } } })
		expect(result.issues).toEqual([expect.objectContaining({ path: ['fields', 'ein', 'default'], message: expect.stringContaining('does not fit its mask') })])
		expect(validate(definition).issues).toBeUndefined()
	})

	it('takes a mask string on a binding but not on a layer, which takes only true or false', () => {
		const pdf = (layer: Record<string, unknown>) => ({ ...definition, layers: { pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', ...layer } } })
		const refused = validate(pdf({ format: { text: { mask: '### ## ####' } } }))
		expect(refused.issues).toEqual([expect.objectContaining({
			path: expect.arrayContaining(['format', 'text', 'mask']),
			message: expect.stringContaining('takes only true or false; set a mask string on a binding or a template placeholder'),
		})])
		expect(validate(pdf({ format: { text: { mask: false } } })).issues).toBeUndefined()
		expect(validate(pdf({ bindings: { box: { path: 'fields.ssn', format: { text: { mask: '### ## ####' } } } } })).issues).toBeUndefined()
	})

	it('refuses a split binding to a group the mask does not have', () => {
		const layer = (bindings: Record<string, string>) => ({ ...definition, layers: { pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindings } } })
		expect(validate(layer({ last: 'ssn:3' })).issues).toBeUndefined()
		expect(validate(layer({ last: 'ssn:4' })).issues).toEqual([expect.objectContaining({ message: expect.stringContaining('names group 4, but the mask ###-##-#### has 3 groups') })])
	})
})

describe('a family-first person format', () => {
	const people = {
		kind: 'form' as const,
		name: 'people',
		version: '1.0.0',
		fields: { client: { type: 'person' as const, label: 'Client' }, city: { type: 'text' as const, label: 'City', maxLength: 20 } },
	}
	const resolver = createMemoryResolver({ contents: { 'note.md': new TextEncoder().encode('{{fields.client}}') } })

	it('warns that a person with only a name cannot be reordered, on a layer and on a binding', async () => {
		const onLayer = await validateLayers({ ...people, layers: { note: { kind: 'file', mimeType: 'text/markdown', path: 'note.md', format: { person: { order: 'family-first' } } } } }, { resolver })
		expect(onLayer.issues).toBeUndefined()
		expect(onLayer.warnings).toEqual([expect.objectContaining({ path: ['layers', 'note', 'format', 'person', 'order'], message: expect.stringContaining('cannot be reordered') })])
		const plain = await validateLayers({ ...people, layers: { note: { kind: 'file', mimeType: 'text/markdown', path: 'note.md' } } }, { resolver })
		expect(plain.warnings).toBeUndefined()
	})
})
