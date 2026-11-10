import { describe, expect, test } from 'vitest'
import type { Form } from '@asterdoc/types'
import { bundle, checklist, document, form, FormRuleViolationError, FormValidationError } from '@/artifacts'

const definition: Form = {
	kind: 'form',
	name: 'loan',
	version: '1.0.0',
	title: 'Loan',
	fields: {
		amount: { type: 'number', required: true },
		term: { type: 'number' },
	},
	rules: {
		amountPositive: { expr: 'amount > 0', message: 'Amount must be positive' },
		termShort: { expr: 'term <= 360', message: 'Term is unusually long', severity: 'warning' },
	},
	layers: { main: { kind: 'inline', mimeType: 'text/plain', text: 'Amount: {{fields.amount}}' } },
}

const draft = (fields: Record<string, unknown>) => form(definition).fill({ fields } as never)

describe('render with require complete', () => {
	test('refuses a draft with a missing required value', async () => {
		await expect(draft({}).render({ require: 'complete' })).rejects.toBeInstanceOf(FormValidationError)
	})

	test('refuses a draft whose error-severity rule fails', async () => {
		const rejection = draft({ amount: -5 }).render({ require: 'complete' })
		await expect(rejection).rejects.toBeInstanceOf(FormRuleViolationError)
		await expect(rejection).rejects.toMatchObject({ ruleResult: { errors: [{ ruleId: 'amountPositive' }] } })
	})

	test('renders a draft whose only failing rule is a warning', async () => {
		const warned = draft({ amount: 1000, term: 480 })
		expect(warned.validateRules().warnings.map((rule) => rule.ruleId)).toEqual(['termShort'])
		await expect(warned.render({ require: 'complete' })).resolves.toBe('Amount: 1,000')
	})

	test('renders a complete draft', async () => {
		await expect(draft({ amount: 1000, term: 36 }).render({ require: 'complete' })).resolves.toBe('Amount: 1,000')
	})

	test('without require, an incomplete draft still renders', async () => {
		await expect(draft({ amount: -5 }).render()).resolves.toBe('Amount: -5')
		await expect(draft({}).render()).resolves.toBe('Amount: ')
	})

	test('refuses what prepareForSigning refuses, with the same error', async () => {
		const incomplete = draft({ amount: -5 })
		expect(() => incomplete.prepareForSigning()).toThrow(FormRuleViolationError)
		await expect(incomplete.render({ require: 'complete' })).rejects.toThrow(
			'Form rules validation failed: Amount must be positive',
		)
	})
})

describe('require where it cannot apply', () => {
	const layers = { main: { kind: 'inline' as const, mimeType: 'text/plain', text: 'Hello' } }

	test('a form definition refuses it', async () => {
		await expect(form(definition).render({ require: 'complete' } as never)).rejects.toThrow(/cannot render with require: "complete"/)
		await expect(form(definition).render({ require: 'complete' } as never)).rejects.toThrow(/only a filled form's render\(\) checks completeness/)
	})

	test('a document refuses it', async () => {
		const doc = document({ kind: 'document', name: 'note', version: '1.0.0', title: 'Note', layers })
		await expect(doc.render({ require: 'complete' } as never)).rejects.toThrow(/cannot render with require: "complete"/)
		await expect(doc.render()).resolves.toBe('Hello')
	})

	test('a checklist and its filled form refuse it', async () => {
		const list = checklist({ kind: 'checklist', name: 'steps', version: '1.0.0', title: 'Steps', items: [{ id: 'done', title: 'Done' }], layers })
		await expect(list.render({ require: 'complete' } as never)).rejects.toThrow(/cannot render with require: "complete"/)
		await expect(list.fill().render({ require: 'complete' } as never)).rejects.toThrow(/cannot render with require: "complete"/)
	})

	test('a bundle refuses it', async () => {
		const prepared = bundle({ name: 'pack', version: '1.0.0', title: 'Pack', contents: [{ type: 'path', key: 'note', path: './note.yaml' }] }).prepare()
		await expect(prepared.render({ require: 'complete' } as never)).rejects.toThrow(/cannot render with require: "complete"/)
	})

	test('a filled form refuses an unknown value', async () => {
		await expect(draft({ amount: 1000 }).render({ require: 'everything' } as never)).rejects.toThrow(/the one value is 'complete'/)
	})
})
