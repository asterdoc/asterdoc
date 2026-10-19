import { describe, test, expect } from 'vitest'
import { form } from '@/artifacts'
import { computeFillState } from '@/fill-state/engine'
import { evaluateFormDefs } from '@/logic/runtime/evaluation/form-evaluator'

const createForm = () =>
	form()
		.name('required-empty')
		.fields({
			name: { type: 'text', label: 'Name', required: true },
			enabled: { type: 'boolean', label: 'Enabled' },
			license: { type: 'text', label: 'License', required: 'fields.enabled == true' },
			profile: {
				type: 'fieldset',
				fields: { city: { type: 'text', required: true } },
			},
			tags: { type: 'list', item: { type: 'text', required: true } },
		})
		.annexes({ proof: { title: 'Proof', required: true } })
		.build()

const openRequired = (data: Record<string, unknown>): string[] =>
	createForm().fill({ fields: data } as any).getFillState().openRequired.map((item) => item.key)

describe('required values set to an empty string', () => {
	test('a required text field stays open and fails validation', () => {
		const draft = createForm().fill({
			fields: { name: '', profile: { city: 'Austin' } },
			annexes: { proof: { name: 'proof.pdf', mimeType: 'application/pdf' } },
		} as any)

		expect(draft.getFillState().summary.requiredRemaining).toBe(1)
		expect(draft.isValid()).toBe(false)
		expect(draft.validate().errors.map((error) => error.field)).toEqual(['fields.name'])
	})

	test('a whitespace-only string still counts as filled', () => {
		expect(openRequired({ name: '  ', profile: { city: 'Austin' } })).not.toContain('name')
	})

	test('a required nested fieldset field stays open', () => {
		expect(openRequired({ name: 'Ada', profile: { city: '' } })).toContain('profile.city')
	})

	test('a required list item stays open', () => {
		expect(openRequired({ name: 'Ada', profile: { city: 'Austin' }, tags: ['a', ''] })).toContain('tags[1]')
	})

	test('an expression-required field stays open', () => {
		expect(openRequired({ name: 'Ada', enabled: true, license: '' })).toContain('license')
	})

	test('a required annex set to an empty string stays open', () => {
		const f = createForm()
		const fields = { name: 'Ada', profile: { city: 'Austin' } }
		const result = evaluateFormDefs(f, { fields, parties: {} })
		if (!('value' in result)) throw new Error('form evaluation failed')
		const state = computeFillState(f, fields, {}, { proof: '' }, result.value)
		expect(state.openRequired.map((item) => item.key)).toContain('proof')
	})
})
