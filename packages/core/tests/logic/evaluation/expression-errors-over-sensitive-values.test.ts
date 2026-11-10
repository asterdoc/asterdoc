import { describe, expect, test } from 'vitest'
import type { Form } from '@asterdoc/types'
import { TemplateError } from '@asterdoc/render/text'
import { form } from '@/artifacts'
import { evaluateBundleInclusion } from '@/artifacts/bundle/inclusion'
import { resolvePartyPayment } from '@/logic/runtime/evaluation/payment-resolver'

const build = (sensitive: boolean, extra: Partial<Form> = {}): Form => ({
	kind: 'form',
	name: 'patterned',
	version: '1.0.0',
	title: 'Patterned',
	fields: {
		pattern: { type: 'text', sensitive },
		algorithm: { type: 'text', sensitive },
		other: { type: 'text', required: 'matches("abc", fields.pattern)' },
		rows: { type: 'list', item: { type: 'fieldset', fields: { code: { type: 'text', sensitive }, note: { type: 'text', visible: 'matches("abc", item.code)' } } } },
	},
	defs: { shaped: { type: 'boolean', value: 'matches("abc", fields.pattern)' } },
	...extra,
})

const surfaces = (definition: Form, fields: Record<string, unknown>, test_?: object) => {
	const instance = form(test_ ? { ...definition, tests: [test_ as never] } : definition)
	const draft = instance.fill({ fields } as never)
	return {
		issues: draft.getFillState().issues,
		errors: draft.validate().errors,
		tests: test_ ? instance.runTests().results[0]?.errors : [],
	}
}

describe('an expression error over a sensitive value names no value', () => {
	test('a required condition and a computed value, on every surface', () => {
		const fields = { pattern: '(SECRET' }
		const found = surfaces(build(true), fields, { name: 'bad', input: { fields }, expect: { valid: false } })
		expect(found.issues.map((issue) => issue.message).sort()).toEqual([
			'Failed to evaluate computed value "shaped"',
			'Failed to resolve form expression',
		])
		expect(found.issues.every((issue) => issue.originalError === undefined)).toBe(true)
		expect(found.errors.length).toBeGreaterThan(0)
		expect(found.tests?.length).toBeGreaterThan(0)
		expect(JSON.stringify(found)).not.toContain('SECRET')
	})

	test('a row condition reading a sensitive member through item', () => {
		const found = surfaces(build(true), { rows: [{ code: '(SECRET' }] })
		expect(found.issues.map((issue) => issue.message)).toEqual(['Failed to resolve form expression'])
		expect(JSON.stringify(found)).not.toContain('SECRET')
	})

	test('a fixed-choice argument read from a sensitive field', () => {
		const definition = build(true, { defs: { valid: { type: 'boolean', value: 'checkDigit("79927398713", fields.algorithm)' } } })
		const found = surfaces(definition, { algorithm: 'SECRET-ALGO' })
		expect(found.issues.map((issue) => issue.message)).toEqual(['Failed to evaluate computed value "valid"'])
		expect(JSON.stringify(found)).not.toContain('SECRET')
	})

	test('the same errors over values that are not sensitive keep their text', () => {
		const found = surfaces(build(false), { pattern: '(open', rows: [{ code: '(open' }] })
		expect(found.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
			'Failed to evaluate computed value "shaped": type-error: Invalid pattern: "(open"',
			'Failed to resolve form expression: Invalid pattern: "(open"',
		]))
		expect(found.issues.every((issue) => issue.originalError !== undefined)).toBe(true)
	})
})

describe('bundle include conditions and definitions', () => {
	const applicant = (sensitive: boolean): Form => ({
		kind: 'form',
		name: 'applicant',
		version: '1.0.0',
		title: 'Applicant',
		fields: { pattern: { type: 'text', sensitive }, owners: { type: 'list', item: { type: 'fieldset', fields: { ssn: { type: 'text', sensitive: true } } } } },
	})
	const packet = {
		kind: 'bundle',
		name: 'packet',
		version: '1.0.0',
		title: 'Packet',
		defs: { shaped: { type: 'boolean', value: 'matches("abc", forms.applicant.fields.pattern)' } },
		contents: [
			{ type: 'path', key: 'applicant', path: './applicant.yaml' },
			{ type: 'path', key: 'schedule', path: './schedule.yaml', include: 'matches("abc", forms.applicant.fields.pattern)' },
			{ type: 'path', key: 'owners', path: './owners.yaml', include: 'count(forms.applicant.fields.owners) > 0 and matches("abc", "(")' },
		],
	} as never
	const evaluate = (sensitive: boolean, pattern: string) =>
		evaluateBundleInclusion(packet, { applicant: { form: applicant(sensitive), fields: { pattern, owners: [{ ssn: '111223333' }] } } })

	test('an include condition and a definition over a sensitive member field name no value', () => {
		const state = evaluate(true, '(SECRET')
		expect(state.decisions.find((decision) => decision.key === 'schedule')?.reason).toBe('Invalid include expression "matches("abc", forms.applicant.fields.pattern)"')
		expect(state.errors.slice(0, 2)).toEqual([
			'Bundle definition "shaped": Invalid include expression "matches("abc", forms.applicant.fields.pattern)"',
			'Content "schedule": Invalid include expression "matches("abc", forms.applicant.fields.pattern)"',
		])
		expect(JSON.stringify(state)).not.toContain('SECRET')
	})

	test('the same errors over a field that is not sensitive keep their text', () => {
		const state = evaluate(false, '(open')
		expect(state.errors.slice(0, 2).every((error) => error.includes('Invalid pattern: "(open"'))).toBe(true)
	})

	test('counting a member form list is not a sensitive read, so its error keeps the text', () => {
		expect(evaluate(true, 'abc').decisions.find((decision) => decision.key === 'owners')?.reason).toContain('Invalid pattern: "("')
	})
})

describe('bundle include paths with bracket keys and list aggregates', () => {
	const member = (sensitive: boolean): Form => ({
		kind: 'form',
		name: 'source',
		version: '1.0.0',
		title: 'Source',
		fields: {
			pattern: { type: 'text', sensitive },
			owners: { type: 'list', item: { type: 'fieldset', fields: { ssn: { type: 'text', sensitive } } } },
		},
	})
	const packet = (include: string) => ({
		kind: 'bundle',
		name: 'packet',
		version: '1.0.0',
		title: 'Packet',
		contents: [{ type: 'path', key: 'source', path: './source.yaml' }, { type: 'path', key: 'extra', path: './extra.yaml', include }],
	}) as never
	const decide = (include: string, sensitive = true, owners: unknown[] = [{ ssn: '111223333' }]) =>
		evaluateBundleInclusion(packet(include), { source: { form: member(sensitive), fields: { pattern: '(SECRET', owners } } })

	test('a bracket member key reads like a dotted one', () => {
		const state = decide('matches("abc", forms["source"].fields.pattern)')
		expect(state.errors).toEqual(['Content "extra": Invalid include expression "matches("abc", forms["source"].fields.pattern)"'])
		expect(JSON.stringify(state)).not.toContain('SECRET')
		expect(decide('matches("abc", forms["source"].fields.pattern)', false).errors[0]).toContain('Invalid pattern')
	})

	test('a bare forms read reveals when a member holds a sensitive value', () => {
		const include = 'matches("abc", forms[lower("SOURCE")].fields.pattern)'
		const state = decide(include)
		expect(state.errors).toEqual([`Content "extra": Invalid include expression "${include}"`])
		expect(JSON.stringify(state)).not.toContain('SECRET')
		expect(decide(include, false).errors[0]).toContain('Invalid pattern')
	})

	test('an aggregate over a member list path resolves', () => {
		const include = 'count(forms.source.fields.owners, forms.source.fields.owners.ssn == "111223333") > 0'
		expect(decide(include).decisions.find((decision) => decision.key === 'extra')).toMatchObject({ status: 'included', value: true })
		expect(decide(include, true, [{ ssn: '000000000' }]).decisions.find((decision) => decision.key === 'extra')).toMatchObject({ status: 'excluded', value: false })
	})
})

describe('party payment expressions', () => {
	const payer = (sensitive: boolean): Form => ({
		kind: 'form',
		name: 'payer',
		version: '1.0.0',
		title: 'Payer',
		fields: { pattern: { type: 'text', sensitive }, currencyCode: { type: 'text', sensitive } },
		parties: { payer: { label: 'Payer' } },
	})
	const amountFails = { amount: 'matches("abc", fields.pattern) ? 10 : 20', currency: '"USD"' }
	const currencyWrong = { amount: '10', currency: 'fields.currencyCode' }
	const resolve = (sensitive: boolean, amount: Record<string, string>) => () =>
		resolvePartyPayment(payer(sensitive), { required: true, amount: { type: 'money', value: amount } } as never, { fields: { pattern: '(SECRET', currencyCode: 'SECRETCUR' } })

	test('an expression over a sensitive field fails without its error or value', () => {
		expect(resolve(true, amountFails)).toThrow(new Error('Could not resolve the payment amount expression "matches("abc", fields.pattern) ? 10 : 20"'))
		expect(resolve(true, currencyWrong)).toThrow('The payment currency expression "fields.currencyCode" did not resolve to an ISO 4217 alpha-3 code.')
	})

	test('an expression over fields that are not sensitive keeps its error and value', () => {
		expect(resolve(false, amountFails)).toThrow(/Invalid pattern: "\(SECRET"/)
		expect(resolve(false, currencyWrong)).toThrow('(got "SECRETCUR")')
	})
})

describe('template expressions at render', () => {
	const layered = (sensitive: boolean, text: string): Form => ({
		...build(sensitive),
		defs: undefined,
		layers: { main: { kind: 'inline', mimeType: 'text/plain', text } },
	})
	const render = (sensitive: boolean, text: string) =>
		form(layered(sensitive, text)).fill({ fields: { pattern: '(SECRET', rows: [{ code: '(SECRET' }] } } as never).render()

	test('a placeholder over a sensitive field fails without the value', async () => {
		const failure = await render(true, 'X {{matches("abc", fields.pattern)}}').catch((error: Error) => error)
		expect(failure).toBeInstanceOf(TemplateError)
		expect((failure as Error).message).toContain('The expression could not be evaluated.')
		expect((failure as Error).message).not.toContain('SECRET')
	})

	test('a loop row expression fails without the value', async () => {
		const failure = await render(true, '{{#each fields.rows}}{{matches("abc", item.code)}}{{/each}}').catch((error: Error) => error)
		expect((failure as Error).message).not.toContain('SECRET')
	})

	test('a placeholder over a field that is not sensitive keeps the error', async () => {
		const failure = await render(false, 'X {{matches("abc", fields.pattern)}}').catch((error: Error) => error)
		expect((failure as Error).message).toContain('Invalid pattern')
	})
})
