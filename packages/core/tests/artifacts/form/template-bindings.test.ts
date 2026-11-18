import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { a } from '@/artifacts'
import { validate, validateLayers } from '@/index'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { createLayerRenderer } from '@asterdoc/render'
import { extractPdfData, inspectAcroFormFields } from '@asterdoc/render/pdf'
import type { Form } from '@asterdoc/types'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const template = new Uint8Array(readFileSync(join(fixtures, 'one-field-form.pdf')))
const resolver = createMemoryResolver({ contents: { 'form.pdf': template } })

const CITY_LINE = '{{fields.home.locality}}, {{fields.home.region}} {{fields.home.postalCode}}'

const definition = (binding: unknown, text = CITY_LINE) => ({
	kind: 'form' as const,
	name: 'template-bindings-form',
	version: '1.0.0',
	title: 'Template Bindings Form',
	fields: {
		home: { type: 'address' as const, label: 'Home' },
		rent: { type: 'number' as const, label: 'Rent' },
		months: { type: 'number' as const, label: 'Months' },
		kind: { type: 'enum' as const, label: 'Kind', enum: [{ value: 'P', label: 'Partnership' }, { value: 'C', label: 'C corporation' }] },
	},
	defs: { total: { type: 'number' as const, value: 'fields.rent * fields.months' }, long: { type: 'boolean' as const, value: 'fields.months > 6' } },
	parties: { tenant: { label: 'Tenant', partyType: 'person' as const } },
	layers: {
		pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindings: { name: binding } },
		markdown: { kind: 'inline' as const, mimeType: 'text/markdown', text },
	},
	defaultLayer: 'pdf',
})

const data = {
	fields: { home: { line1: '2150 Market Street', locality: 'Boston', region: 'MA', postalCode: '02110', country: 'US' }, rent: 1200, months: 12, kind: 'P' },
	parties: { tenant: { id: 'tenant-0', name: 'Ada Lovelace' } },
}

const filled = async (binding: unknown, text?: string) => (await a.form.load(definition(binding, text) as never, { resolver })).fill(data as never)
const boxValue = async (bytes: unknown) => (await inspectAcroFormFields(bytes as Uint8Array)).find((field) => field.name === 'name')?.value

describe('a template binding of a form', () => {
	test('prints several values with the text between them', async () => {
		expect(validate(definition({ template: CITY_LINE })).issues).toBeUndefined()
		expect(await boxValue(await (await filled({ template: CITY_LINE })).render({ renderer: createLayerRenderer() }))).toBe('Boston, MA 02110')
	})

	test('reads a party, and a computed value by its name, as a text layer does', async () => {
		const text = '{{parties.tenant.name}} pays {{total}}{{#if long}} over {{fields.months}} months{{/if}}'
		const draft = await filled({ template: text }, text)
		expect(validate(definition({ template: text }, text)).issues).toBeUndefined()
		expect(await boxValue(await (await draft).render({ renderer: createLayerRenderer() }))).toBe('Ada Lovelace pays 14,400 over 12 months')
		expect(await (await draft).render({ renderer: createLayerRenderer(), layer: 'markdown' })).toBe('Ada Lovelace pays 14,400 over 12 months')
	})

	test('prints a choice as its option value where a text layer prints its label', async () => {
		const text = 'Kind: {{fields.kind}}'
		const draft = await filled({ template: text }, text)
		expect(await boxValue(await (await draft).render({ renderer: createLayerRenderer() }))).toBe('Kind: P')
		expect(await (await draft).render({ renderer: createLayerRenderer(), layer: 'markdown' })).toBe('Kind: Partnership')
	})

	test('passes validateLayers on a single-line field, and fails there with a line break', async () => {
		expect((await validateLayers(definition({ template: CITY_LINE }), { resolver })).issues).toBeUndefined()
		const broken = await validateLayers(definition({ template: `{{parties.tenant.name}}\n${CITY_LINE}` }), { resolver })
		expect(broken.issues?.map((issue) => issue.message)).toEqual([
			'Layer "pdf", binding "name": the template has a line break, and "name" is a single-line field in "form.pdf", which prints it as a space; a line break starts a new line only in a multi-line field.',
		])
	})

	test('reads back from the filled PDF', async () => {
		const form = definition({ template: CITY_LINE })
		const pdf = await (await filled({ template: CITY_LINE })).render({ renderer: createLayerRenderer() }) as Uint8Array
		const result = await extractPdfData({ pdf, form: form as unknown as Form, bindings: form.layers.pdf.bindings as never })
		expect(result.data.fields).toEqual({ home: { locality: 'Boston', region: 'MA', postalCode: '02110' } })
	})

	test('fails validation on a value the form does not declare', () => {
		expect(validate(definition({ template: '{{fields.home.locality}} {{subtotal}}' })).issues?.map((issue) => issue.message))
			.toEqual([expect.stringMatching(/^Layer "pdf", binding "name": Template error at line 1, column 28 in \{\{subtotal\}\}: .*subtotal/)])
	})
})
