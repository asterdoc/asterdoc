import { describe, expect, test } from 'vitest'
import type { Form } from '@asterdoc/types'
import { form } from '@/artifacts'
import { buildFormContext } from '@/logic/runtime/evaluation/context-builder'
import { evaluateRules } from '@/logic/runtime/evaluation/rule-evaluator'

const build = (fields: Form['fields'], rules: Form['rules'], defs?: Form['defs']): Form => ({
	kind: 'form',
	name: 'explained',
	version: '1.0.0',
	title: 'Explained',
	fields,
	rules,
	...(defs && { defs }),
})

const explain = (definition: Form, values: Record<string, unknown>, raw?: boolean) => {
	const draft = form(definition).fill({ fields: values } as never)
	return draft.validateRules(raw === undefined ? undefined : { explain: { raw } }).rules
}

describe('a failed rule explains the values it reads', () => {
	test('prints each value the expression reads, keeping the rule message', () => {
		const [result] = explain(
			build({ amount: { type: 'number' }, term: { type: 'number' } }, { fits: { expr: 'amount * term < 1000', message: 'Too large' } }),
			{ amount: 50, term: 30 },
		)
		expect(result).toEqual({
			ruleId: 'fits',
			passed: false,
			message: 'Too large',
			severity: 'error',
			explanation: { values: [{ path: 'amount', value: '50' }, { path: 'term', value: '30' }] },
		})
	})

	test('a passing rule carries no explanation', () => {
		const [result] = explain(build({ amount: { type: 'number' } }, { positive: { expr: 'amount > 0', message: 'm' } }), { amount: 5 })
		expect(result).not.toHaveProperty('explanation')
	})

	test('a missing value prints as null', () => {
		const [result] = explain(build({ name: { type: 'text' } }, { named: { expr: 'length(fields.name) > 0', message: 'm' } }), {})
		expect(result?.explanation?.values).toEqual([{ path: 'fields.name', value: 'null' }])
	})
})

describe('sensitive values are redacted', () => {
	const id = { type: 'ssn', number: '123456789' }

	test('an identification field is sensitive by default', () => {
		const [whole, number] = explain(
			build({ taxId: { type: 'identification' } }, {
				whole: { expr: 'fields.taxId == null', message: 'm' },
				number: { expr: 'length(fields.taxId.number) == 11', message: 'm' },
			}),
			{ taxId: id },
		)
		expect(whole?.explanation?.values).toEqual([{ path: 'fields.taxId', value: '[redacted] (object, length 2)' }])
		expect(number?.explanation?.values).toEqual([{ path: 'fields.taxId.number', value: '[redacted] (string, length 9)' }])
	})

	test('an identification field that sets sensitive false prints its value', () => {
		const [result] = explain(
			build({ taxId: { type: 'identification', sensitive: false } }, { number: { expr: 'length(fields.taxId.number) == 11', message: 'm' } }),
			{ taxId: id },
		)
		expect(result?.explanation?.values).toEqual([{ path: 'fields.taxId.number', value: '"123456789"' }])
	})

	test('a text field marked sensitive is redacted, by its bare id and through fields', () => {
		const [result] = explain(
			build({ account: { type: 'text', sensitive: true }, bank: { type: 'text' } }, {
				account: { expr: 'length(account) == 10 and fields.account != bank', message: 'm' },
			}),
			{ account: '000123456789', bank: 'First' },
		)
		expect(result?.explanation?.values).toEqual([
			{ path: 'account', value: '[redacted] (string, length 12)' },
			{ path: 'bank', value: '"First"' },
			{ path: 'fields.account', value: '[redacted] (string, length 12)' },
		])
	})

	test('a sensitive value inside a fieldset is redacted where the fieldset prints', () => {
		const [result] = explain(
			build({
				applicant: { type: 'fieldset', fields: { name: { type: 'text' }, ssn: { type: 'text', sensitive: true } } },
			}, { listed: { expr: 'fields.applicant == null', message: 'm' } }),
			{ applicant: { name: 'Ada', ssn: '123456789' } },
		)
		expect(result?.explanation?.values).toEqual([
			{ path: 'fields.applicant', value: '{"name": "Ada", "ssn": [redacted] (string, length 9)}' },
		])
	})

	test('every value under a sensitive fieldset is sensitive', () => {
		const [result] = explain(
			build({
				bank: { type: 'fieldset', sensitive: true, fields: { account: { type: 'text', sensitive: false } } },
			}, { listed: { expr: 'fields.bank.account == ""', message: 'm' } }),
			{ bank: { account: '42' } },
		)
		expect(result?.explanation?.values).toEqual([{ path: 'fields.bank.account', value: '[redacted] (string, length 2)' }])
	})

	test('raw values print only when the caller asks for them', () => {
		const definition = build({ account: { type: 'text', sensitive: true } }, { account: { expr: 'length(account) == 12', message: 'm' } })
		expect(explain(definition, { account: '1234' }, false)[0]?.explanation?.values).toEqual([
			{ path: 'account', value: '[redacted] (string, length 4)' },
		])
		expect(explain(definition, { account: '1234' }, true)[0]?.explanation?.values).toEqual([{ path: 'account', value: '"1234"' }])
	})

	test('a computed value read from a sensitive field is redacted, unless it is a boolean', () => {
		const [shown, valid] = explain(
			build(
				{ account: { type: 'text', sensitive: true } },
				{
					shown: { expr: 'upperAccount == ""', message: 'm' },
					valid: { expr: 'longEnough', message: 'm' },
				},
				{
					upperAccount: { type: 'string', value: 'upper(fields.account)' },
					longEnough: { type: 'boolean', value: 'length(fields.account) > 8' },
				},
			),
			{ account: 'ab12' },
		)
		expect(shown?.explanation?.values).toEqual([{ path: 'upperAccount', value: '[redacted] (string, length 4)' }])
		expect(valid?.explanation?.values).toEqual([{ path: 'longEnough', value: 'false' }])
	})

	test('rules evaluated without a form redact every value unless raw', () => {
		const definition = build({ amount: { type: 'number' } }, { positive: { expr: 'amount > 0', message: 'm' } })
		const context = buildFormContext(definition, { fields: { amount: -1234 } })
		const redacted = evaluateRules(definition.rules, { amount: -1234 }, new Map(), context)
		const raw = evaluateRules(definition.rules, { amount: -1234 }, new Map(), context, { explain: { raw: true } })
		expect(redacted.errors[0]?.explanation?.values).toEqual([{ path: 'amount', value: '[redacted] (number, length 5)' }])
		expect(raw.errors[0]?.explanation?.values).toEqual([{ path: 'amount', value: '-1234' }])
	})
})

describe('a path that resolves to a list', () => {
	const rows = (count: number, value: (index: number) => unknown) => Array.from({ length: count }, (_, index) => value(index))

	test('prints at most ten elements and counts the rest', () => {
		const [result] = explain(
			build(
				{ items: { type: 'list', item: { type: 'fieldset', fields: { amount: { type: 'number' } } } } },
				{ small: { expr: 'sum(fields.items.amount) < 10', message: 'm' } },
			),
			{ items: rows(12, (index) => ({ amount: index + 1 })) },
		)
		expect(result?.explanation?.values).toEqual([
			{ path: 'fields.items.amount', value: '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, … 2 more]' },
		])
	})

	test('redacts each element of a sensitive list and caps them', () => {
		const [result] = explain(
			build(
				{ ids: { type: 'list', item: { type: 'identification' } } },
				{ none: { expr: 'count(fields.ids) == 0', message: 'm' } },
			),
			{ ids: rows(11, () => ({ type: 'ssn', number: '123456789' })) },
		)
		const printed = result?.explanation?.values[0]?.value ?? ''
		expect(printed.match(/\[redacted\] \(object, length 2\)/g)).toHaveLength(10)
		expect(printed).toMatch(/… 1 more\]$/)
		expect(printed).not.toContain('123456789')
	})

	test('redacts a sensitive member read across rows', () => {
		const [result] = explain(
			build(
				{ owners: { type: 'list', item: { type: 'fieldset', fields: { ssn: { type: 'text', sensitive: true } } } } },
				{ none: { expr: 'count(fields.owners.ssn) == 0', message: 'm' } },
			),
			{ owners: [{ ssn: '111223333' }, { ssn: '444556666' }] },
		)
		expect(result?.explanation?.values).toEqual([
			{ path: 'fields.owners.ssn', value: '[[redacted] (string, length 9), [redacted] (string, length 9)]' },
		])
	})
})

describe('a member read through a list of sensitive items is redacted', () => {
	const id = { type: 'ssn', number: '123456789' }
	const printed = (definition: Form, values: Record<string, unknown>) => explain(definition, values)[0]?.explanation?.values ?? []

	test('a member of identification rows', () => {
		const values = printed(
			build({ ids: { type: 'list', item: { type: 'identification' } } }, { none: { expr: 'count(fields.ids.number) == 0', message: 'm' } }),
			{ ids: [id] },
		)
		expect(values).toEqual([{ path: 'fields.ids.number', value: '[[redacted] (string, length 9)]' }])
		expect(JSON.stringify(values)).not.toContain('123456789')
	})

	test('a member of rows whose fieldset item is sensitive', () => {
		const values = printed(
			build(
				{ owners: { type: 'list', item: { type: 'fieldset', sensitive: true, fields: { ssn: { type: 'text' } } } } },
				{ none: { expr: 'count(fields.owners.ssn) == 0', message: 'm' } },
			),
			{ owners: [{ ssn: '111223333' }] },
		)
		expect(JSON.stringify(values)).not.toContain('111223333')
		expect(values[0]?.value).toBe('[[redacted] (string, length 9)]')
	})

	test('a member of a list of lists of identification', () => {
		const values = printed(
			build(
				{ grid: { type: 'list', item: { type: 'list', item: { type: 'identification' } } } },
				{ none: { expr: 'count(fields.grid.number) == 0', message: 'm' } },
			),
			{ grid: [[id, id]] },
		)
		expect(JSON.stringify(values)).not.toContain('123456789')
	})

	test('a member of money rows marked sensitive, and a computed value over it', () => {
		const definition = build(
			{ pays: { type: 'list', item: { type: 'money', sensitive: true } } },
			{
				small: { expr: 'sum(fields.pays.amount) < 10', message: 'm' },
				totalSmall: { expr: 'total < 10', message: 'm' },
			},
			{ total: { type: 'number', value: 'sum(fields.pays.amount)' } },
		)
		const [small, totalSmall] = explain(definition, { pays: [{ amount: 98765, currency: 'USD' }] })
		expect(small?.explanation?.values).toEqual([{ path: 'fields.pays.amount', value: '[[redacted] (number, length 5)]' }])
		expect(totalSmall?.explanation?.values).toEqual([{ path: 'total', value: '[redacted] (number, length 5)' }])
	})

	test('whole person rows marked sensitive', () => {
		const values = printed(
			build({ people: { type: 'list', item: { type: 'person', sensitive: true } } }, { none: { expr: 'count(fields.people) == 0', message: 'm' } }),
			{ people: [{ name: 'Grace Hopper' }] },
		)
		expect(values).toEqual([{ path: 'fields.people', value: '[[redacted] (object, length 1)]' }])
	})

	test('whole rows of a fieldset with a sensitive member', () => {
		const values = printed(
			build(
				{ owners: { type: 'list', item: { type: 'fieldset', fields: { name: { type: 'text' }, ssn: { type: 'text', sensitive: true } } } } },
				{ none: { expr: 'count(fields.owners) == 0', message: 'm' } },
			),
			{ owners: [{ name: 'Ada', ssn: '111223333' }] },
		)
		expect(values).toEqual([{ path: 'fields.owners', value: '[{"name": "Ada", "ssn": [redacted] (string, length 9)}]' }])
	})
})

describe('computed values derived from sensitive values', () => {
	test('a computed value that reads a derived computed value is derived too', () => {
		const [result] = explain(
			build(
				{ account: { type: 'text', sensitive: true } },
				{ shown: { expr: 'suffixed == ""', message: 'm' } },
				{
					upperAccount: { type: 'string', value: 'upper(fields.account)' },
					suffixed: { type: 'string', value: 'upperAccount + "-x"' },
				},
			),
			{ account: 'ab12' },
		)
		expect(result?.explanation?.values).toEqual([{ path: 'suffixed', value: '[redacted] (string, length 6)' }])
	})

	const owners = { type: 'list' as const, item: { type: 'fieldset' as const, fields: { ssn: { type: 'text' as const, sensitive: true }, share: { type: 'number' as const } } } }
	const ownerRows = [{ ssn: '111223333', share: 60 }, { ssn: '444556666', share: 40 }]

	test('counting the rows of a list or a party role is not derived', () => {
		const definition: Form = {
			...build(
				{ owners },
				{
					counted: { expr: 'owned > 5', message: 'm' },
					measured: { expr: 'listed > 5', message: 'm' },
					sellersCounted: { expr: 'sellerCount > 5', message: 'm' },
				},
				{
					owned: { type: 'number', value: 'count(fields.owners)' },
					listed: { type: 'number', value: 'length(fields.owners)' },
					sellerCount: { type: 'number', value: 'count(parties.sellers)' },
				},
			),
			parties: { sellers: { label: 'Seller', max: 3 } },
		}
		const results = form(definition)
			.fill({ fields: { owners: ownerRows }, parties: { sellers: [{ id: 'sellers-0', name: 'Acme', taxId: '12-3456789' }] } } as never)
			.validateRules().rules
		expect(results.map((result) => result.explanation?.values)).toEqual([
			[{ path: 'owned', value: '2' }],
			[{ path: 'listed', value: '2' }],
			[{ path: 'sellerCount', value: '1' }],
		])
	})

	test('a count whose filter reads a sensitive member is derived', () => {
		const [result] = explain(
			build({ owners }, { none: { expr: 'matched > 5', message: 'm' } }, { matched: { type: 'number', value: 'count(fields.owners, fields.owners.ssn == "111223333")' } }),
			{ owners: ownerRows },
		)
		expect(result?.explanation?.values).toEqual([{ path: 'matched', value: '[redacted] (number, length 1)' }])
	})

	test('reading a row of a list whose rows hold a sensitive member is derived', () => {
		const [result] = explain(
			build({ owners }, { none: { expr: 'firstSet > 5', message: 'm' } }, { firstSet: { type: 'number', value: 'fields.owners[0] == null ? 0 : 1' } }),
			{ owners: ownerRows },
		)
		expect(result?.explanation?.values).toEqual([{ path: 'firstSet', value: '[redacted] (number, length 1)' }])
	})

	test('a sum over members that are not sensitive is not derived', () => {
		const [result] = explain(
			build({ owners }, { none: { expr: 'shares > 500', message: 'm' } }, { shares: { type: 'number', value: 'sum(fields.owners.share)' } }),
			{ owners: ownerRows },
		)
		expect(result?.explanation?.values).toEqual([{ path: 'shares', value: '100' }])
	})

	test('a computed value over non-sensitive values prints', () => {
		const [result] = explain(
			build({ amount: { type: 'number' } }, { big: { expr: 'doubled > 100', message: 'm' } }, { doubled: { type: 'number', value: 'fields.amount * 2' } }),
			{ amount: 7 },
		)
		expect(result?.explanation?.values).toEqual([{ path: 'doubled', value: '14' }])
	})
})

describe('organization and party identifiers are sensitive', () => {
	const employer = { name: 'Acme', taxId: '12-3456789', entityId: 'C0123456' }
	const withEmployer = (rules: Form['rules']): Form => ({
		...build({ org: { type: 'organization' }, publicOrg: { type: 'organization', sensitive: false } }, rules),
		parties: { employer: { label: 'Employer', partyType: 'organization' } },
	})
	const run = (rules: Form['rules'], fields: Record<string, unknown> = {}) =>
		form(withEmployer(rules)).fill({ fields, parties: { employer: { id: 'employer-0', ...employer } } } as never).validateRules().rules

	test('a party taxId is redacted where the path ends in it', () => {
		const [result] = run({ id: { expr: 'length(parties.employer.taxId) == 1', message: 'm' } })
		expect(result?.explanation?.values).toEqual([{ path: 'parties.employer.taxId', value: '[redacted] (string, length 10)' }])
	})

	test('a whole party prints with its identifiers redacted', () => {
		const [result] = run({ none: { expr: 'parties.employer == null', message: 'm' } })
		const printed = result?.explanation?.values[0]?.value ?? ''
		expect(printed).toContain('"name": "Acme"')
		expect(printed).toContain('"taxId": [redacted] (string, length 10)')
		expect(printed).toContain('"entityId": [redacted] (string, length 8)')
		expect(printed).not.toContain('12-3456789')
	})

	test('an organization field redacts its identifiers unless it sets sensitive false', () => {
		const [org, publicOrg, whole] = run(
			{
				org: { expr: 'length(fields.org.taxId) == 1', message: 'm' },
				publicOrg: { expr: 'length(fields.publicOrg.taxId) == 1', message: 'm' },
				whole: { expr: 'fields.org == null', message: 'm' },
			},
			{ org: employer, publicOrg: employer },
		)
		expect(org?.explanation?.values).toEqual([{ path: 'fields.org.taxId', value: '[redacted] (string, length 10)' }])
		expect(publicOrg?.explanation?.values).toEqual([{ path: 'fields.publicOrg.taxId', value: '"12-3456789"' }])
		expect(whole?.explanation?.values[0]?.value).toBe('{"name": "Acme", "taxId": [redacted] (string, length 10), "entityId": [redacted] (string, length 8)}')
	})
})

describe('a rule expression error', () => {
	const failing = (sensitive: boolean) => explain(
		build({ pattern: { type: 'text', sensitive } }, { shaped: { expr: 'matches("abc", fields.pattern)', message: 'm' } }),
		{ pattern: '(secret' },
	)[0]

	test('does not quote the error when the rule reads a sensitive value', () => {
		const result = failing(true)
		expect(result?.message).toBe('Rule expression error')
		expect(JSON.stringify(result)).not.toContain('secret')
	})

	test('keeps the error when the rule reads no sensitive value', () => {
		expect(failing(false)?.message).toMatch(/^Rule expression error: /)
	})
})
