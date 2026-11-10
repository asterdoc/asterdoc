import { z } from 'zod';
import { IDENTIFIER_PATTERN } from '../../primitives/name';

const TestInputSchema = z.object({
	fields: z.record(z.string(), z.unknown()).describe('Field values, as passed to update()').optional(),
	parties: z.record(z.string(), z.unknown()).describe('Party values, as passed to update()').optional(),
	annexes: z.record(z.string(), z.unknown()).describe('Annex values, as passed to update()').optional(),
}).strict();

export const FormTestCaseSchema = z.object({
	name: z.string().min(1).max(200).describe('Name of the test case, unique within the form'),
	input: TestInputSchema.describe('The values applied to an empty draft through update(), so masks, countries and regions are canonicalized as for any input. Published artifacts carry their tests: use synthetic values only'),
	context: z.object({
		asOf: z.iso.datetime({ offset: true })
			.describe('The instant today() and now() read, an ISO 8601 instant with an explicit timezone')
			.optional(),
	}).strict().describe('The runtime context the draft is filled with').optional(),
	expect: z.object({
		valid: z.boolean().describe('Whether the draft is valid: the input is accepted, no value is missing or invalid, and every error-severity rule passes'),
		failures: z.array(z.string().min(1).max(100).regex(IDENTIFIER_PATTERN))
			.describe('The ids of every rule that fails, warnings included, in any order. Omitted, failed rules are not compared')
			.optional(),
	}).strict(),
}).strict().meta({
	title: 'FormTestCase',
	description: 'A test case for a form: input applied to an empty draft and the validation outcome expected',
});
