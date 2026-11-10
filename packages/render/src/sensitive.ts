import type { Form, FormField } from '@asterdoc/types'
import { pathSegments } from './path'

export { redactedValue } from '@asterdoc/format'

/** The members of an organization value and of a party that identify it, sensitive by default. */
export const IDENTIFIER_MEMBERS = ['taxId', 'entityId'] as const

/** Whether a field's own definition marks its value sensitive: `sensitive`, or an identification field unless it sets `sensitive: false`. */
export function isSensitiveField(field: FormField): boolean {
	return field.sensitive ?? field.type === 'identification'
}

/**
 * Whether the value at a `fields.` path is sensitive: a field on the path is
 * sensitive, or the path ends in the taxId or entityId of an organization
 * field that does not set `sensitive: false`.
 */
export function isSensitivePath(form: Form, path: string): boolean {
	const [root, ...segments] = pathSegments(path)
	if (root !== 'fields') return false
	let scope: Record<string, FormField> | undefined = form.fields
	let field: FormField | undefined
	for (const segment of segments) {
		if (field?.type === 'list' && /^\d+$/.test(segment)) {
			field = field.item
		} else {
			if (field?.type === 'organization') return (IDENTIFIER_MEMBERS as readonly string[]).includes(segment) && field.sensitive !== false
			while (field?.type === 'list') field = field.item
			if (field) scope = field.type === 'fieldset' ? field.fields : undefined
			field = scope && Object.prototype.hasOwnProperty.call(scope, segment) ? scope[segment] : undefined
			if (!field) return false
		}
		if (isSensitiveField(field)) return true
	}
	return false
}
