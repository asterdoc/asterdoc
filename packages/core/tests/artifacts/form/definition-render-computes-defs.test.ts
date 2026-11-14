import { describe, expect, test } from 'vitest'
import { form } from '@/artifacts'

const definition = {
	kind: 'form' as const,
	name: 'supplement-form',
	version: '1.0.0',
	title: 'Supplement Form',
	fields: {
		lastName: { type: 'text' as const, label: 'Last name' },
		rehired: { type: 'boolean' as const, label: 'Rehired' },
	},
	defs: {
		supplementName: { type: 'string' as const, value: "fields.rehired ? fields.lastName : ''" },
	},
	layers: {
		text: { kind: 'inline' as const, mimeType: 'text/plain', text: 'unused' },
	},
	defaultLayer: 'text',
}

function recorder() {
	const seen: Array<Record<string, unknown> | undefined> = []
	const renderer = {
		render: async (request: { data: { defs?: Record<string, unknown> } }) => {
			seen.push(request.data.defs)
			return ''
		},
	}
	return { seen, renderer: renderer as never }
}

describe('rendering a form definition with a payload', () => {
	test('gives the renderer the computed values that a filled form gives it', async () => {
		const fromDefinition = recorder()
		await form.from(definition).render({ data: { fields: { lastName: 'Kabongo', rehired: true } }, renderer: fromDefinition.renderer })
		const fromFilled = recorder()
		await form.from(definition).fill({ fields: { lastName: 'Kabongo', rehired: true } }).render({ renderer: fromFilled.renderer })
		expect(fromDefinition.seen).toEqual([{ supplementName: 'Kabongo' }])
		expect(fromDefinition.seen).toEqual(fromFilled.seen)
	})

	test('computes them from the payload, so a condition that is false leaves the value empty', async () => {
		const { seen, renderer } = recorder()
		await form.from(definition).render({ data: { fields: { lastName: 'Kabongo', rehired: false } }, renderer })
		expect(seen).toEqual([{ supplementName: '' }])
	})

	test('keeps the computed values that the caller sends', async () => {
		const { seen, renderer } = recorder()
		await form.from(definition).render({ data: { fields: { lastName: 'Kabongo', rehired: true }, defs: { supplementName: 'Sent by the caller' } }, renderer })
		expect(seen).toEqual([{ supplementName: 'Sent by the caller' }])
	})

	test('adds nothing for a form that has no computed values', async () => {
		const { defs: _defs, ...plain } = definition
		const { seen, renderer } = recorder()
		await form.from(plain).render({ data: { fields: { lastName: 'Kabongo' } }, renderer })
		expect(seen).toEqual([undefined])
	})
})
