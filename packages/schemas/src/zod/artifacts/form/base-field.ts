import { z } from 'zod';
import { CondExprSchema } from '../expressions/cond-expr';

export const BaseFieldSchema = z.object({
	label: z.string().min(1).max(200).describe('Display label for the field').optional(),
	description: z.string().min(1).max(1000).describe('Description or help text for the field').optional(),
	required: CondExprSchema.optional(),
	visible: CondExprSchema.optional(),
	sensitive: z.boolean()
		.describe('Whether the value is sensitive, such as an account or tax number: rule explanations, validation and render errors, and AI tool errors print it as [redacted] with its kind and length. A value under a sensitive fieldset or list is sensitive too. Identification fields are sensitive unless this is false, and so are the taxId and entityId of an organization field')
		.optional(),
}).strict();
