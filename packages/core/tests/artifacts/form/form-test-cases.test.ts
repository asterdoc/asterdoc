import { describe, expect, test } from 'vitest'
import type { Form, FormTestCase } from '@asterdoc/types'
import { field, form } from '@/artifacts'

const definition = (tests: FormTestCase[]): Form => ({
	kind: 'form',
	name: 'enrolment',
	version: '1.0.0',
	title: 'Enrolment',
	fields: {
		ssn: { type: 'text', mask: '###-##-####', sensitive: true },
		taxId: { type: 'identification' },
		startDate: { type: 'date', required: true },
		term: { type: 'number' },
	},
	rules: {
		ssnLength: { expr: 'length(ssn) == 9', message: 'SSN has nine digits' },
		notPast: { expr: 'fields.startDate >= today()', message: 'Start date is in the past' },
		termShort: { expr: 'term <= 360', message: 'Term is unusually long', severity: 'warning' },
	},
	tests,
})

const run = (...tests: FormTestCase[]) => form(definition(tests)).runTests()

const valid = { ssn: '123-45-6789', startDate: '2026-12-01', term: 36 }

describe('form test cases', () => {
	test('a case whose outcome matches passes, with input canonicalized through update()', () => {
		const report = run({
			name: 'complete',
			input: { fields: valid },
			context: { asOf: '2026-11-10T12:00:00Z' },
			expect: { valid: true, failures: [] },
		})
		expect(report).toEqual({
			passed: true,
			results: [{
				name: 'complete',
				passed: true,
				valid: true,
				failures: [],
				expected: { valid: true, failures: [] },
				errors: [],
				sensitiveInputs: ['fields.ssn'],
			}],
		})
	})

	test('a case whose outcome differs fails, and so does the report', () => {
		const report = run({
			name: 'short ssn',
			input: { fields: { ...valid, ssn: '1234' } },
			context: { asOf: '2026-11-10T12:00:00Z' },
			expect: { valid: true },
		})
		expect(report.passed).toBe(false)
		expect(report.results[0]).toMatchObject({ passed: false, valid: false, failures: ['ssnLength'] })
	})

	test('asOf fixes the clock today() reads', () => {
		const late = { name: 'late', input: { fields: valid }, context: { asOf: '2027-01-15T00:00:00Z' }, expect: { valid: false, failures: ['notPast'] } }
		const early = { name: 'early', input: { fields: valid }, context: { asOf: '2026-01-15T00:00:00Z' }, expect: { valid: true, failures: [] } }
		expect(run(late, early).results.map((result) => [result.name, result.passed])).toEqual([['late', true], ['early', true]])
	})

	test('without asOf, today() reads the current instant', () => {
		const report = run({ name: 'long ago', input: { fields: { ...valid, startDate: '2000-01-01' } }, expect: { valid: false, failures: ['notPast'] } })
		expect(report.passed).toBe(true)
	})

	test('failures are compared as a set and include warnings, and an omitted list is not compared', () => {
		const input = { fields: { ...valid, ssn: '1', term: 480 } }
		const context = { asOf: '2026-11-10T12:00:00Z' }
		const report = run(
			{ name: 'any order', input, context, expect: { valid: false, failures: ['termShort', 'ssnLength'] } },
			{ name: 'missing one', input, context, expect: { valid: false, failures: ['ssnLength'] } },
			{ name: 'not compared', input, context, expect: { valid: false } },
		)
		expect(report.results.map((result) => [result.name, result.passed, result.failures])).toEqual([
			['any order', true, ['ssnLength', 'termShort']],
			['missing one', false, ['ssnLength', 'termShort']],
			['not compared', true, ['ssnLength', 'termShort']],
		])
	})

	test('a warning-only draft is valid', () => {
		const report = run({
			name: 'long term',
			input: { fields: { ...valid, term: 480 } },
			context: { asOf: '2026-11-10T12:00:00Z' },
			expect: { valid: true, failures: ['termShort'] },
		})
		expect(report.passed).toBe(true)
	})

	test('an input update() refuses makes the draft invalid with no rule failures, and reports why without the value', () => {
		const report = run({ name: 'bad mask', input: { fields: { ssn: '12-345' } }, expect: { valid: false, failures: [] } })
		expect(report.results[0]).toMatchObject({ passed: true, valid: false, failures: [] })
		expect(report.results[0]?.errors[0]).toMatchObject({ field: 'fields.ssn' })
		expect(report.results[0]?.errors[0]).not.toHaveProperty('value')
		expect(run({ name: 'bad mask', input: { fields: { ssn: '12-345' } }, expect: { valid: true } }).passed).toBe(false)
	})

	test('names the sensitive fields an input sets, identification included', () => {
		const report = run(
			{ name: 'both', input: { fields: { ssn: '123456789', taxId: { type: 'ein', number: '121234567' }, term: 1 } }, expect: { valid: false } },
			{ name: 'neither', input: { fields: { term: 1 } }, expect: { valid: false } },
		)
		expect(report.results.map((result) => result.sensitiveInputs)).toEqual([['fields.ssn', 'fields.taxId'], []])
	})

	test('names sensitive fields set inside a fieldset and in list rows', () => {
		const nested: Form = {
			kind: 'form',
			name: 'owners',
			version: '1.0.0',
			title: 'Owners',
			fields: {
				applicant: { type: 'fieldset', fields: { name: { type: 'text' }, ssn: { type: 'text', sensitive: true } } },
				owners: { type: 'list', item: { type: 'fieldset', fields: { name: { type: 'text' }, ssn: { type: 'text', sensitive: true } } } },
			},
			tests: [{
				name: 'nested',
				input: { fields: { applicant: { name: 'Ada', ssn: '111223333' }, owners: [{ name: 'B' }, { name: 'C', ssn: '444556666' }] } },
				expect: { valid: true },
			}],
		}
		expect(form(nested).runTests().results[0]?.sensitiveInputs).toEqual(['fields.applicant.ssn', 'fields.owners[1].ssn'])
	})

	test('names organization and party identifiers an input sets', () => {
		const identified: Form = {
			kind: 'form',
			name: 'employer',
			version: '1.0.0',
			title: 'Employer',
			fields: { org: { type: 'organization' }, publicOrg: { type: 'organization', sensitive: false } },
			parties: { employer: { label: 'Employer', partyType: 'organization' } },
			tests: [{
				name: 'identified',
				input: {
					fields: { org: { name: 'Acme', taxId: '12-3456789' }, publicOrg: { name: 'Open', taxId: '98-7654321' } },
					parties: { employer: { id: 'employer-0', name: 'Acme', entityId: 'C0123' } },
				},
				expect: { valid: true },
			}],
		}
		expect(form(identified).runTests().results[0]?.sensitiveInputs).toEqual(['fields.org.taxId', 'parties.employer.entityId'])
	})

	test('asOf reaches now(), computed values, and required and visible conditions', () => {
		const clocked: Form = {
			kind: 'form',
			name: 'clocked',
			version: '1.0.0',
			title: 'Clocked',
			fields: {
				deadline: { type: 'date', required: true },
				lateReason: { type: 'text', visible: 'isLate', required: 'isLate' },
				filedAt: { type: 'datetime' },
			},
			defs: { isLate: { type: 'boolean', value: 'today() > fields.deadline' } },
			rules: { notFuture: { expr: 'fields.filedAt <= now()', message: 'Filed in the future' } },
		}
		const run = (asOf: string) => form({
			...clocked,
			tests: [{ name: 'on time', input: { fields: { deadline: '2026-12-01', filedAt: '2026-11-20T10:00:00Z' } }, context: { asOf }, expect: { valid: true, failures: [] } }],
		}).runTests().results[0]
		expect(run('2026-11-25T00:00:00Z')).toMatchObject({ passed: true, valid: true, failures: [] })
		const late = run('2026-12-15T00:00:00Z')
		expect(late).toMatchObject({ passed: false, valid: false, failures: [] })
		expect(late?.errors.map((error) => error.field)).toEqual(['fields.lateReason'])
		expect(run('2026-11-19T00:00:00Z')).toMatchObject({ passed: false, valid: false, failures: ['notFuture'] })
	})

	test('a form without tests passes with no results', () => {
		const { tests: _tests, ...rest } = definition([])
		expect(form(rest as Form).runTests()).toEqual({ passed: true, results: [] })
	})
})

describe('the builder takes test cases', () => {
	test('read-only cases, as in an as-const artifact, are set and run', () => {
		const cases = [
			{ name: 'a nine-digit code passes', input: { fields: { code: '123456789' } }, expect: { valid: true, failures: [] } },
			{ name: 'a short code fails codeLength', input: { fields: { code: '123' } }, expect: { valid: false, failures: ['codeLength'] } },
		] as const
		const report = form()
			.name('coded')
			.field('code', field.text())
			.rules({ codeLength: { expr: 'length(code) == 9', message: 'The code has nine digits', paths: ['fields.code'] as const } })
			.tests(cases)
			.build()
			.runTests()
		expect(report.results.map((result) => [result.name, result.passed])).toEqual([
			['a nine-digit code passes', true],
			['a short code fails codeLength', true],
		])
	})
})
