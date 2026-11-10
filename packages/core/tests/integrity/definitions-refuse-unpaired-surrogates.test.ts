import { describe, expect, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'
import { a } from '@/artifacts'
import { validate } from '@/validation/artifact'
import { LONE_SURROGATE_MESSAGE } from '@/integrity/canonical-json'

const form = (overrides: Record<string, unknown> = {}) => ({
	$schema: ASTERDOC_SCHEMA_URL,
	kind: 'form',
	name: 'lease',
	version: '1.0.0',
	fields: { tenant: { type: 'text', label: 'Tenant' } },
	layers: { body: { kind: 'inline', mimeType: 'text/markdown', text: 'Tenant {{fields.tenant}}' } },
	...overrides,
})

describe('a definition string with an unpaired UTF-16 surrogate', () => {
	test('is an issue at its path when the definition is validated', () => {
		const result = validate(form({ title: 'Lease \ud800' }))
		expect(result.issues).toEqual([{ message: LONE_SURROGATE_MESSAGE, path: ['title'] }])
	})

	test('is an issue at its path deep in the definition, and in a property name', () => {
		const nested = validate(form({ fields: { tenant: { type: 'text', label: 'Tenant \udc00' } } }))
		expect(nested.issues).toEqual([{ message: LONE_SURROGATE_MESSAGE, path: ['fields', 'tenant', 'label'] }])
		const key = validate(form({
			layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'lease.pdf', bindings: { ['Name\ud800']: 'tenant' } } },
		}))
		expect(key.issues).toEqual([{ message: LONE_SURROGATE_MESSAGE, path: ['layers', 'pdf', 'bindings', 'Name\ud800'] }])
	})

	test('is refused when the definition is read, naming its path', () => {
		expect(() => a.form.from(form({ title: 'Lease \ud800' }))).toThrow(`Invalid Form at title: ${LONE_SURROGATE_MESSAGE}`)
	})

	test('is refused at fill when it was written into the definition after it was read', () => {
		const instance = a.form.from(form())
		instance.toJSON({ includeSchema: false }).fields!.tenant!.label = 'Tenant \ud800'
		expect(() => instance.fill()).toThrow(/unpaired UTF-16 surrogate/)
	})

	test('a well-formed pair, such as an emoji, is accepted', () => {
		expect(validate(form({ title: 'Lease 😀' })).issues).toBeUndefined()
		expect(a.form.from(form({ title: 'Lease 😀' })).title).toBe('Lease 😀')
	})
})
