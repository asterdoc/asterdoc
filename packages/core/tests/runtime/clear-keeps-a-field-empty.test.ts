import { describe, expect, test } from 'vitest'
import type { DraftFormJSON, Form } from '@asterdoc/types'
import { form, runtimeFormFromJSON, type DraftForm } from '@/artifacts'

async function shippingForm() {
	return await form.load({
		kind: 'form',
		name: 'shipping',
		fields: {
			ship: { type: 'boolean' },
			carrier: { type: 'text', default: 'Post', visible: 'fields.ship == true' },
			reference: { type: 'text', default: 'REF-1', required: true },
			notes: { type: 'text', default: 'None' },
			pickup: { type: 'date', default: '2026-01-05' },
			home: { type: 'address' },
			phone: { type: 'phone' },
		},
		layers: { text: { kind: 'inline', mimeType: 'text/plain', text: 'Carrier [{{fields.carrier}}] Notes [{{fields.notes}}]' } },
	} as never)
}

describe('clear() records the choice to leave a field empty', () => {
	test('a cleared defaulted field stays empty through later changes and prints empty', async () => {
		const draft = (await shippingForm()).fill({ fields: { ship: true } } as never).clear('fields.notes' as never)
		const later = draft.update({ fields: { ship: false } } as never).update({ fields: { ship: true } } as never)

		expect(draft.fields).not.toHaveProperty('notes')
		expect(later.fields).not.toHaveProperty('notes')
		expect(later.fields).toHaveProperty('carrier', 'Post')
		expect(later.validate().errors).toEqual([])
		expect(await later.render()).toBe('Carrier [Post] Notes []')
	})

	test('reset removes the choice, so the default applies again', async () => {
		const reset = (await shippingForm()).fill({} as never).clear('fields.notes' as never).reset('fields.notes' as never)

		expect(reset.fields).toHaveProperty('notes', 'None')
		expect(reset.givenFields).not.toHaveProperty('notes')
	})

	test('a cleared required field is reported as missing', async () => {
		const draft = (await shippingForm()).fill({} as never)
		const cleared = draft.clear('fields.reference' as never)

		expect(draft.validate().valid).toBe(true)
		expect(cleared.validate().errors).toEqual([{ field: 'fields.reference', message: 'Missing required field: fields.reference' }])
	})

	test('a cleared field that a later change hides is not a value given for a field that does not apply', async () => {
		const hidden = (await shippingForm()).fill({ fields: { ship: true } } as never).clear('fields.carrier' as never).update({ fields: { ship: false } } as never)

		expect(hidden.getFillState().notApplicable).toEqual([])
		expect(hidden.validate().errors).toEqual([])
		expect(hidden.update({ fields: { ship: true } } as never).fields).not.toHaveProperty('carrier')
	})

	test('toJSON writes the choice as null and a restored draft keeps it', async () => {
		const json = (await shippingForm()).fill({ fields: { ship: true } } as never).clear('fields.notes' as never).toJSON() as DraftFormJSON<Form>
		const restored = (await runtimeFormFromJSON(json)) as DraftForm<Form>
		const withoutChoice = (await runtimeFormFromJSON({ ...json, fields: { ship: true } })) as DraftForm<Form>

		expect(json.fields.notes).toBeNull()
		expect(restored.fields).not.toHaveProperty('notes')
		expect(restored.update({ fields: { ship: false } } as never).fields).not.toHaveProperty('notes')
		expect(withoutChoice.fields).toHaveProperty('notes', 'None')
	})

	test('fill takes null as the same choice, so a stored draft payload fills back unchanged', async () => {
		const given = (await shippingForm()).fill({} as never).clear('fields.notes' as never).givenFields
		const refilled = (await shippingForm()).fill({ fields: given } as never)

		expect(given).toEqual({ notes: null })
		expect(refilled.fields).not.toHaveProperty('notes')
		expect(refilled.fields).toHaveProperty('reference', 'REF-1')
	})

	test('a draft restored from JSON keeps a cleared field of a value type with a canonical form', async () => {
		const json = (await shippingForm()).fill({} as never).clear('fields.pickup' as never).clear('fields.home' as never).clear('fields.phone' as never).toJSON() as DraftFormJSON<Form>
		const restored = (await runtimeFormFromJSON(json)) as DraftForm<Form>

		expect(json.fields.pickup).toBeNull()
		expect(restored.fields).not.toHaveProperty('pickup')
		expect(restored.givenFields).toEqual({ pickup: null, home: null, phone: null })
	})

	test('null is refused for a part of a value, with a message that names the rule', async () => {
		const result = (await shippingForm()).safeFill({ fields: { home: { locality: null } } } as never)

		expect(result.success).toBe(false)
		expect(!result.success && result.error.message).toContain('null leaves a whole field empty, so it is accepted only for a field or a fieldset member')
	})

	test('null for a field the form does not declare names the unknown field, and nothing about parts of a value', async () => {
		const result = (await shippingForm()).safeFill({ fields: { nickname: null } } as never)

		expect(!result.success && result.error.message).toContain('unknown field "nickname"')
		expect(!result.success && result.error.message).not.toContain('part of a value')
	})

	test('parseData takes null as the same choice as fill, and a cleared required field is missing', async () => {
		const parsed = (await shippingForm()).safeParseData({ fields: { notes: null, ship: true } })
		const missing = (await shippingForm()).safeParseData({ fields: { reference: null } })

		expect(parsed.errors).toBeNull()
		expect(parsed.data?.fields).not.toHaveProperty('notes')
		expect(parsed.data?.fields).toHaveProperty('carrier', 'Post')
		expect(missing.errors).toEqual([{ field: 'fields.reference', message: 'Missing required field: fields.reference' }])
	})
})
