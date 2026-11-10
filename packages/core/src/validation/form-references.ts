import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Form } from '@asterdoc/types'
import { fieldAtSegments } from '@/logic/shared/sensitive-values'

function namesField(form: Form, path: string): boolean {
	const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.')
	if (segments[0] !== 'fields' || segments.length < 2 || segments.some((segment) => segment.length === 0)) return false
	return fieldAtSegments(form.fields, segments.slice(1)) !== undefined
}

/**
 * Check what a form's rules and tests name: each rule path names a field,
 * each test name is unique, and each expected failure names a rule.
 */
export function validateFormReferences(form: Form): StandardSchemaV1.Issue[] {
	const issues: StandardSchemaV1.Issue[] = []
	for (const [ruleId, rule] of Object.entries(form.rules ?? {})) {
		rule.paths?.forEach((path, index) => {
			if (!namesField(form, path)) {
				issues.push({ message: `Rule "${ruleId}" path "${path}" names no field; a rule path is a field path such as fields.ssn`, path: ['rules', ruleId, 'paths', index] })
			}
		})
	}
	const names = new Set<string>()
	form.tests?.forEach((test, index) => {
		if (names.has(test.name)) issues.push({ message: `Test name "${test.name}" is used more than once`, path: ['tests', index, 'name'] })
		names.add(test.name)
		test.expect.failures?.forEach((ruleId, position) => {
			if (!Object.prototype.hasOwnProperty.call(form.rules ?? {}, ruleId)) {
				issues.push({ message: `Test "${test.name}" expects rule "${ruleId}" to fail, but the form declares no such rule`, path: ['tests', index, 'expect', 'failures', position] })
			}
		})
	})
	return issues
}
