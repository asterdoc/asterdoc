import { describe, expect, test } from 'vitest'
import { form } from '@/artifacts'

async function createFormWithDefaults() {
	return await form.load(form()
		.name('clear-reset')
		.fields({
			title: { type: 'text', default: 'Untitled' },
			count: { type: 'number', default: 0 },
			settings: {
				type: 'fieldset',
				fields: {
					enabled: { type: 'boolean', default: false },
					note: { type: 'text' },
				},
			},
			rows: {
				type: 'list',
				item: {
					type: 'fieldset',
					fields: {
						label: { type: 'text', default: 'Row' },
						value: { type: 'number' },
					},
				},
			},
		})
		.annex('proof', { title: 'Proof' })
		.build())
}

describe('DraftForm clear and reset', () => {
	test('applies recursive defaults at creation, including existing list rows', async () => {
		const draft = (await createFormWithDefaults()).fill({ fields: { settings: {}, rows: [{}] } } as never)

		expect(draft.fields).toMatchObject({
			title: 'Untitled',
			count: 0,
			settings: { enabled: false },
			rows: [{ label: 'Row' }],
		})
	})

	test('clear leaves a defaulted field empty, and reset brings its default back', async () => {
		const draft = (await createFormWithDefaults()).fill({ fields: { title: 'Custom', count: 1, settings: { note: 'Keep' } } } as never)
		const cleared = draft.clear('fields.title')
		const reset = cleared.reset('fields.title')

		expect(cleared.fields).not.toHaveProperty('title')
		expect(cleared.givenFields.title).toBeNull()
		expect(cleared.update({ fields: { count: 2 } } as never).fields).not.toHaveProperty('title')
		expect(reset.fields.title).toBe('Untitled')
		expect(draft.reset('fields.title').fields.title).toBe('Untitled')
		expect(cleared.update({ fields: { title: 'Again' } } as never).fields.title).toBe('Again')
	})

	test('clears and resets nested fieldsets and list item paths', async () => {
		const draft = (await createFormWithDefaults()).fill({
			fields: { settings: { enabled: true, note: 'Keep' }, rows: [{ label: 'First', value: 7 }] },
		} as never)

		expect(draft.clear('fields.settings.enabled').fields.settings).toEqual({ note: 'Keep' })
		expect(draft.clear('fields.settings.enabled').reset('fields.settings.enabled').fields.settings).toEqual({ enabled: false, note: 'Keep' })
		expect(draft.clear('fields.settings').fields).not.toHaveProperty('settings')
		expect(draft.reset('fields.settings').fields.settings).toEqual({ enabled: false })
		expect(draft.clear('fields.rows[0].label').fields.rows).toEqual([{ value: 7 }])
		expect(draft.reset('fields.rows[0].label').fields.rows).toEqual([{ label: 'Row', value: 7 }])
		expect(draft.clear('fields.rows[0]').fields.rows).toEqual([])
	})

	test('reset does not invent list rows and annex reset removes the stored value', async () => {
		const draft = (await createFormWithDefaults()).fill({
			fields: { rows: [{ label: 'First' }] },
			annexes: { proof: { name: 'proof.pdf', mimeType: 'application/pdf' } },
		} as never)

		const cleared = draft.clear('fields.rows').clear('annexes.proof')
		const reset = cleared.reset('fields.rows').reset('annexes.proof')

		expect(reset.fields).not.toHaveProperty('rows')
		expect(reset.annexes).not.toHaveProperty('proof')
	})

	test('rejects paths that are not present in the definition', async () => {
		const draft = (await createFormWithDefaults()).fill({ fields: {} } as never)

		expect(() => draft.clear('fields.unknown' as never)).toThrow('unknown field')
		expect(() => draft.reset('fields.rows.label' as never)).toThrow('numeric bracket index')
		expect(() => draft.clear('annexes.unknown' as never)).toThrow('unknown annex')
	})

	test('reset uses the instance definition snapshot', async () => {
		const definition = await createFormWithDefaults()
		const draft = (await definition).fill({ fields: { title: 'Custom' } } as never)
		const authoring = (await definition).toJSON({ includeSchema: false }) as unknown as {
			fields?: Record<string, { default?: string }>
		}
		;(authoring.fields!.title as { default?: string }).default = 'Changed later'

		expect(draft.reset('fields.title').fields.title).toBe('Untitled')
	})
})
