import { describe, expect, test } from 'vitest'
import type { Form } from '@asterdoc/types'
import { form } from '@/artifacts'
import { validate } from '@/validation/artifact'

const base = (overrides: Partial<Form> = {}): Form => ({
	kind: 'form',
	name: 'applicant',
	version: '1.0.0',
	title: 'Applicant',
	fields: {
		ssn: { type: 'text' },
		address: { type: 'fieldset', fields: { postalCode: { type: 'text' } } },
		items: { type: 'list', item: { type: 'fieldset', fields: { amount: { type: 'number' } } } },
	},
	...overrides,
})

const messages = (definition: Form): string[] => (validate(definition).issues ?? []).map((issue) => issue.message)

describe('rule paths', () => {
	test('a failed rule returns its declared paths and its id as the code', () => {
		const draft = form(base({
			rules: { ssnLength: { expr: 'length(ssn) == 9', message: 'SSN has nine digits', paths: ['fields.ssn'] } },
		})).fill({ fields: { ssn: '123' } } as never)
		expect(draft.validateRules().errors).toMatchObject([{ ruleId: 'ssnLength', paths: ['fields.ssn'] }])
	})

	test('a passing rule returns its paths too', () => {
		const draft = form(base({
			rules: { ssnLength: { expr: 'length(ssn) == 9', message: 'SSN has nine digits', paths: ['fields.ssn'] } },
		})).fill({ fields: { ssn: '123456789' } } as never)
		expect(draft.validateRules().rules).toMatchObject([{ ruleId: 'ssnLength', passed: true, paths: ['fields.ssn'] }])
	})

	test('a rule without paths stays form level: no paths are inferred from the expression', () => {
		const draft = form(base({
			rules: { ssnLength: { expr: 'length(ssn) == 9', message: 'SSN has nine digits' } },
		})).fill({ fields: { ssn: '123' } } as never)
		expect(draft.validateRules().errors[0]).not.toHaveProperty('paths')
	})

	test('accepts paths into a fieldset and into list rows', () => {
		const definition = base({
			rules: {
				postal: { expr: 'true', message: 'm', paths: ['fields.address.postalCode', 'fields.items.amount', 'fields.items[0].amount', 'fields.items'] },
			},
		})
		expect(validate(definition).issues).toBeUndefined()
	})

	test('refuses a row index on a field that is not a list', () => {
		const definition = base({
			fields: { ...base().fields, tags: { type: 'list', item: { type: 'text' } } },
			rules: { r: { expr: 'true', message: 'm', paths: ['fields.tags[0][3]', 'fields.ssn[0]', 'fields.address.0'] } },
		})
		expect(messages(definition)).toEqual([
			'Rule "r" path "fields.tags[0][3]" names no field; a rule path is a field path such as fields.ssn',
			'Rule "r" path "fields.ssn[0]" names no field; a rule path is a field path such as fields.ssn',
			'Rule "r" path "fields.address.0" names no field; a rule path is a field path such as fields.ssn',
		])
		expect(validate(base({ fields: { ...base().fields, tags: { type: 'list', item: { type: 'text' } } }, rules: { r: { expr: 'true', message: 'm', paths: ['fields.tags[0]'] } } })).issues).toBeUndefined()
	})

	test('refuses a member path into a value that has no member fields', () => {
		const definition = base({ fields: { home: { type: 'address' } }, rules: { r: { expr: 'true', message: 'm', paths: ['fields.home.postalCode'] } } })
		expect(messages(definition)).toHaveLength(1)
	})

	test('refuses a path that names no field', () => {
		const definition = base({ rules: { postal: { expr: 'true', message: 'm', paths: ['fields.address.zip'] } } })
		const result = validate(definition)
		expect(result.issues).toEqual([
			{
				message: 'Rule "postal" path "fields.address.zip" names no field; a rule path is a field path such as fields.ssn',
				path: ['rules', 'postal', 'paths', 0],
			},
		])
		expect(() => form(definition).fill()).toThrow(/names no field/)
	})

	test('refuses a path outside fields, even when its root is a field id', () => {
		expect(messages(base({ rules: { r: { expr: 'true', message: 'm', paths: ['ssn'] } } }))).toEqual([
			'Rule "r" path "ssn" names no field; a rule path is a field path such as fields.ssn',
		])
		expect(messages(base({ rules: { r: { expr: 'true', message: 'm', paths: ['fields'] } } }))).toHaveLength(1)
	})
})

describe('test case references', () => {
	const ruled = (tests: Form['tests']) => base({ rules: { ssnLength: { expr: 'length(ssn) == 9', message: 'm' } }, tests })

	test('accepts expected failures that name declared rules', () => {
		expect(validate(ruled([{ name: 'short', input: { fields: { ssn: '1' } }, expect: { valid: false, failures: ['ssnLength'] } }])).issues).toBeUndefined()
	})

	test('refuses an expected failure that names no rule', () => {
		expect(validate(ruled([{ name: 'short', input: {}, expect: { valid: false, failures: ['ssnFormat'] } }])).issues).toEqual([
			{
				message: 'Test "short" expects rule "ssnFormat" to fail, but the form declares no such rule',
				path: ['tests', 0, 'expect', 'failures', 0],
			},
		])
	})

	test('refuses two test cases with the same name', () => {
		const case_ = { name: 'empty', input: {}, expect: { valid: false } }
		expect(validate(ruled([case_, case_])).issues).toEqual([
			{ message: 'Test name "empty" is used more than once', path: ['tests', 1, 'name'] },
		])
	})
})
