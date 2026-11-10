import { z } from 'zod';

/**
 * Validation Rule Schema
 *
 * Defines a form-level validation rule that uses expressions.
 * Rules evaluate to boolean - true means valid, false means invalid.
 */

/**
 * Severity levels for validation rules.
 * - 'error': Blocks form submission (default)
 * - 'warning': Allows submission but shows warning
 */
export const RuleSeveritySchema = z.enum(['error', 'warning'])
	.describe('Severity level: error blocks submission, warning allows but warns');

/**
 * Validation Rule Schema
 *
 * A validation rule consists of a boolean expression and an error message.
 * The expression has access to field values directly (e.g., "ssn or ein")
 * and defs section values.
 */
export const ValidationRuleSchema = z.object({
	expr: z.string()
		.min(1)
		.max(2000)
		.describe('Boolean expression that must evaluate to true for the form to be valid. Has access to field values directly (e.g., "ssn or ein") and defs section values.'),
	message: z.string()
		.min(1)
		.max(500)
		.describe('Error message displayed when the rule fails (expression evaluates to false)'),
	severity: RuleSeveritySchema
		.describe('Severity level: error (default) blocks submission, warning allows but warns')
		.optional(),
	paths: z.array(z.string().min(1).max(500))
		.min(1)
		.max(50)
		.describe('Field paths the failure attaches to, such as fields.ssn or fields.applicant.ssn. Each must name a field. Without paths the failure is form level; paths are never inferred from the expression')
		.optional(),
}).strict().meta({
	title: 'ValidationRule',
	description: 'A form-level validation rule with a boolean expression and error message',
});
