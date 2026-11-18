import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { a } from '@/artifacts'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const resolver = createMemoryResolver({ contents: { 'form.pdf': new Uint8Array(readFileSync(join(fixtures, 'one-field-form.pdf'))) } })

const definition = (bindings: Record<string, string>) => ({
	kind: 'form' as const,
	name: 'binding-keys',
	version: '1.0.0',
	title: 'Binding keys',
	fields: { title: { type: 'text' as const, label: 'Title' } },
	layers: { pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindings } },
	defaultLayer: 'pdf',
})

describe('form.load and the binding keys of a PDF layer', () => {
	test('loads a layer whose binding keys are fields of its PDF', async () => {
		await expect(a.form.load(definition({ name: 'fields.title' }), { resolver })).resolves.toMatchObject({ name: 'binding-keys' })
	})

	test('refuses a binding key the PDF has no field for, as a render would', async () => {
		await expect(a.form.load(definition({ nmae: 'fields.title' }), { resolver })).rejects.toThrow(/PDF bindings name form fields the template does not have: "nmae"\. Template fields: name/)
	})
})
