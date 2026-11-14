import { describe, test, expect } from 'vitest'
import { form } from '@/artifacts'

const createForm = () =>
	form()
		.name('payee')
		.fields({
			kind: {
				type: 'enum',
				label: 'Kind',
				required: true,
				enum: [
					{ value: 'person', label: 'Person' },
					{ value: 'company', label: 'Company' },
				],
			},
			exemptCode: { type: 'text', label: 'Exempt code', visible: "fields.kind == 'company'" },
			foreignOwners: { type: 'boolean', label: 'Foreign owners', visible: "fields.kind == 'company'" },
			internalNote: { type: 'text', label: 'Internal note', visible: false },
			office: {
				type: 'fieldset',
				visible: "fields.kind == 'company'",
				fields: { city: { type: 'text' }, staffed: { type: 'boolean' } },
			},
			owners: { type: 'list', visible: "fields.kind == 'company'", item: { type: 'text' } },
		})
		.annexes({ charter: { title: 'Charter', visible: "fields.kind == 'company'" } })
		.build()

type Payload = { fields: Record<string, unknown>; annexes?: Record<string, unknown> }

const draftOf = (payload: Payload) => createForm().fill(payload as any)

const listed = (payload: Payload) => draftOf(payload).getFillState().notApplicable.map((item) => [item.kind, item.key, item.condition])

const COMPANY_ONLY = "fields.kind == 'company'"

describe('a value given for a field that does not apply', () => {
	test('is listed with the condition under which the field applies', () => {
		expect(listed({ fields: { kind: 'person', exemptCode: '5' } })).toEqual([['field', 'exemptCode', COMPANY_ONLY]])
	})

	test('is accepted by fill and refused by validate, with the path and the condition', () => {
		const filled = createForm().safeFill({ fields: { kind: 'person', exemptCode: '5' } } as any)
		expect(filled.success).toBe(true)
		const draft = draftOf({ fields: { kind: 'person', exemptCode: '5' } })
		expect(draft.isValid()).toBe(false)
		expect(draft.validate().errors).toEqual([
			{ field: 'fields.exemptCode', message: `A value is given, but this field does not apply. It applies when: ${COMPANY_ONLY}` },
		])
	})

	test('is reported together with a missing required field', () => {
		const errors = draftOf({ fields: { exemptCode: '5' } }).validate().errors.map((error) => error.field)
		expect(errors).toEqual(['fields.kind', 'fields.exemptCode'])
	})

	test('makes the fill batch incomplete and names the problem', () => {
		const batch = draftOf({ fields: { kind: 'person', exemptCode: '5' } }).getFillBatch()
		expect(batch.complete).toBe(false)
		expect(batch.notApplicable).toEqual([
			{ path: 'fields.exemptCode', message: `A value is given, but this field does not apply. It applies when: ${COMPANY_ONLY}` },
		])
	})

	test('lists a hidden fieldset once, not the fields inside it', () => {
		expect(listed({ fields: { kind: 'person', office: { city: 'Erie', staffed: true } } })).toEqual([['field', 'office', COMPANY_ONLY]])
	})

	test('lists a hidden list that has rows, and a hidden annex that has a file', () => {
		expect(listed({ fields: { kind: 'person', owners: ['Ada'] } })).toEqual([['field', 'owners', COMPANY_ONLY]])
		expect(listed({ fields: { kind: 'person' }, annexes: { charter: { name: 'charter.pdf', mimeType: 'application/pdf' } } })).toEqual([
			['annex', 'charter', COMPANY_ONLY],
		])
		const errors = draftOf({ fields: { kind: 'person' }, annexes: { charter: { name: 'charter.pdf', mimeType: 'application/pdf' } } }).validate().errors
		expect(errors).toEqual([{ field: 'annexes.charter', message: `A value is given, but this annex does not apply. It applies when: ${COMPANY_ONLY}` }])
	})
})

describe('a value that is not a problem', () => {
	test('a value in a field whose condition is met', () => {
		const draft = draftOf({ fields: { kind: 'company', exemptCode: '5', office: { city: 'Erie' }, owners: ['Ada'] } })
		expect(draft.getFillState().notApplicable).toEqual([])
		expect(draft.getFillBatch().notApplicable).toEqual([])
		expect(draft.isValid()).toBe(true)
	})

	test('false, an empty string, and a container that holds only those, in a field that does not apply', () => {
		const draft = draftOf({ fields: { kind: 'person', exemptCode: '', foreignOwners: false, office: { city: '', staffed: false }, owners: [] } })
		expect(draft.getFillState().notApplicable).toEqual([])
		expect(draft.isValid()).toBe(true)
	})

	test('true in a checkbox that does not apply is a problem', () => {
		expect(listed({ fields: { kind: 'person', foreignOwners: true } })).toEqual([['field', 'foreignOwners', COMPANY_ONLY]])
	})

	test('a value in a field that is always hidden', () => {
		const draft = draftOf({ fields: { kind: 'person', internalNote: 'checked by phone' } })
		expect(draft.getFillState().notApplicable).toEqual([])
		expect(draft.isValid()).toBe(true)
	})
})
