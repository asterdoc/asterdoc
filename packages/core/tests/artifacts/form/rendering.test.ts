import { describe, expect, test, vi } from 'vitest'
import { form } from '@/artifacts'
import type { Formatter, AsterdocRenderer, RendererLayer } from '@asterdoc/types'

describe('Form rendering', () => {
	const invoice = async () =>
		await form.load(form()
			.name('invoice')
			.fields({ customer: { type: 'text', label: 'Customer' } })
			.inlineLayer('markdown', {
				mimeType: 'text/markdown',
				text: '# Invoice for {{fields.customer}}',
			})
			.defaultLayer('markdown')
			.build())

	test('uses the built-in MIME renderer when no renderer is provided', async () => {
		const definition = await invoice()

		await expect((async () => (await definition).render({ data: { fields: { customer: 'Acme' } } }))()).resolves.toBe('# Invoice for Acme')
		await expect((async () => (await definition).fill({ fields: { customer: 'Acme' } }).render())()).resolves.toBe('# Invoice for Acme')
	})

	test('uses an explicit custom renderer instead of the built-in renderer', async () => {
		const render = vi.fn(async () => 'custom output')
		const renderer: AsterdocRenderer<RendererLayer, string> = { id: 'custom', render }

		const output = await (await invoice())
			.fill({ fields: { customer: 'Acme' } })
			.render({ renderer })

		expect(output).toBe('custom output')
		expect(render).toHaveBeenCalledOnce()
	})

	test('carries the selected formatter through the public artifact render', async () => {
		const formatter = {
			locale: 'en-US',
			timeZone: 'UTC',
			calendar: 'gregory',
			messages: {},
			safeFormatMoney: vi.fn(() => ({ success: true, status: 'formatted', value: 'CUSTOM MONEY' })),
		} as unknown as Formatter
		const definition = await form.load(form()
			.name('formatted-invoice')
			.fields({ amount: { type: 'money' } })
			.inlineLayer('markdown', { mimeType: 'text/markdown', text: '{{fields.amount}}' })
			.defaultLayer('markdown')
			.build())

		await expect(definition.render({ data: { fields: { amount: { amount: 10, currency: 'USD' } } }, formatter })).resolves.toBe('CUSTOM MONEY')
		await expect(definition.fill({ fields: { amount: { amount: 10, currency: 'USD' } } }).render({ formatter })).resolves.toBe('CUSTOM MONEY')
		expect(formatter.safeFormatMoney).toHaveBeenCalledTimes(2)
	})
})
