import type { Form, FormTestCase } from '@asterdoc/types'
import type { FormInstance, ProgressiveFormPayload } from './form'
import { sensitiveInputPaths } from '@/logic/shared/sensitive-values'

/** One test case's outcome. */
export interface FormTestResult {
	/** The test case's name. */
	name: string
	/** Whether the outcome matches the expectation. */
	passed: boolean
	/** Whether the draft was valid. False when the input was refused. */
	valid: boolean
	/** The ids of every rule that failed, warnings included, sorted. Empty when the input was refused. */
	failures: string[]
	/** What the test case expects. */
	expected: FormTestCase['expect']
	/** Why a value was refused, missing or invalid: field and message. A message about a sensitive field names its value only as [redacted] with its kind and length; other messages may quote the input. */
	errors: Array<{ field: string; message: string }>
	/** The paths of sensitive values the input sets, party and organization identifiers included. Test inputs ship inside the artifact, so these should hold synthetic values. */
	sensitiveInputs: string[]
}

/** The outcome of every test case of a form. */
export interface FormTestReport {
	/** True when every test case passed; true for a form with none. */
	passed: boolean
	/** One result per test case, in declaration order. */
	results: FormTestResult[]
}

function refusal(error: Error): Array<{ field: string; message: string }> {
	const errors = (error as { errors?: unknown }).errors
	if (Array.isArray(errors)) {
		return errors.map((entry: { field?: unknown; message?: unknown }) => ({
			field: typeof entry.field === 'string' ? entry.field : 'root',
			message: typeof entry.message === 'string' ? entry.message : String(entry),
		}))
	}
	return [{ field: 'root', message: error.message }]
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
	const wanted = new Set(expected)
	return actual.length === wanted.size && actual.every((id) => wanted.has(id))
}

function outcome(form: FormInstance<Form>, test: FormTestCase): Pick<FormTestResult, 'valid' | 'failures' | 'errors'> {
	const asOf = test.context?.asOf
	const filled = form.safeFill(undefined, asOf === undefined ? undefined : { context: { asOf } })
	if (!filled.success) return { valid: false, failures: [], errors: refusal(filled.error) }
	const updated = filled.data.safeUpdate(test.input as ProgressiveFormPayload<Form>)
	if (!updated.success) return { valid: false, failures: [], errors: refusal(updated.error) }
	const validation = updated.data.validate()
	return {
		valid: validation.valid,
		failures: validation.rules.rules.filter((rule) => !rule.passed).map((rule) => rule.ruleId).sort(),
		errors: validation.errors.map(({ field, message }) => ({ field, message })),
	}
}

/** Run each of a form's test cases on an empty draft and compare the outcome. */
export function runFormTests(definition: Form, form: FormInstance<Form>): FormTestReport {
	const results = (definition.tests ?? []).map((test): FormTestResult => {
		const actual = outcome(form, test)
		const passed = actual.valid === test.expect.valid
			&& (test.expect.failures === undefined || sameIds(actual.failures, test.expect.failures))
		return {
			name: test.name,
			passed,
			...actual,
			expected: structuredClone(test.expect),
			sensitiveInputs: sensitiveInputPaths(definition, test.input),
		}
	})
	return { passed: results.every((result) => result.passed), results }
}
