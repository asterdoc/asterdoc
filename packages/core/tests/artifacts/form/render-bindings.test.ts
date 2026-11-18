import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, test } from 'vitest'
import { a, type ChecklistBuilderInterface, type FormBuilderInterface } from '@/artifacts'
import { validate, type RenderOptions, type RuntimeFormRenderOptions } from '@/index'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { createLayerRenderer } from '@asterdoc/render'
import { inspectAcroFormFields } from '@asterdoc/render/pdf'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const template = new Uint8Array(readFileSync(join(fixtures, 'one-field-form.pdf')))
const resolver = createMemoryResolver({ contents: { 'form.pdf': template } })

const definition = {
	kind: 'form' as const,
	name: 'render-bindings-form',
	version: '1.0.0',
	title: 'Render Bindings Form',
	fields: {
		title: { type: 'text' as const, label: 'Title' },
		other: { type: 'text' as const, label: 'Other' },
	},
	layers: {
		pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindings: { name: 'fields.title' } },
		markdown: { kind: 'inline' as const, mimeType: 'text/markdown', text: 'Title: {{fields.title}}' },
	},
	defaultLayer: 'pdf',
}

const data = { fields: { title: 'Lease', other: 'Addendum' } }
const filled = async () => (await a.form.load(definition, { resolver })).fill(data)
const boxValue = async (bytes: unknown) => (await inspectAcroFormFields(bytes as Uint8Array))
	.find((field) => field.name === 'name')?.value

describe('the bindings of a form layer', () => {
	test('a PDF layer fills from its own bindings', async () => {
		expect(await boxValue(await (await filled()).render({ renderer: createLayerRenderer() }))).toBe('Lease')
		expect(await boxValue(await (await a.form.load(definition, { resolver })).render({ renderer: createLayerRenderer(), data }))).toBe('Lease')
	})

	test('come only from the layer: render refuses a bindings option, so the render check and the render read the same bindings', async () => {
		const bindings = { name: 'fields.other' }
		const refusal = /A form has no render option "bindings"/
		await expect((async () => (await filled()).render({ renderer: createLayerRenderer(), bindings } as never))()).rejects.toThrow(refusal)
		await expect((await a.form.load(definition, { resolver })).render({ renderer: createLayerRenderer(), data, bindings } as never))
			.rejects.toThrow(/A form definition has no render option "bindings"/)
	})

	test('renders a text layer through {{fields.x}}', async () => {
		expect(await (await filled()).render({ renderer: createLayerRenderer(), layer: 'markdown' })).toBe('Title: Lease')
	})

	test('take an option it does not have whose value is undefined as absent', async () => {
		expect(await boxValue(await (await filled()).render({ renderer: createLayerRenderer(), signal: undefined } as never))).toBe('Lease')
		await expect((async () => (await filled()).render({ renderer: createLayerRenderer(), signal: null } as never))()).rejects.toThrow(/A form has no render option "signal"/)
	})

	test('the render options do not name bindings', () => {
		expectTypeOf<RuntimeFormRenderOptions>().not.toHaveProperty('bindings')
		expectTypeOf<RenderOptions>().not.toHaveProperty('bindings')
	})
})

describe('a text template that names a former alias', () => {
	test('validation reports the unknown reference', () => {
		const textOnly = (text: string) => ({ ...definition, defaultLayer: 'markdown', layers: { markdown: { ...definition.layers.markdown, text } } })
		expect(validate(textOnly('Title: {{heading}}')).issues?.map((issue) => issue.message))
			.toEqual([expect.stringContaining('Unknown reference: heading')])
		expect(validate(textOnly('Title: {{fields.title}}')).issues).toBeUndefined()
	})
})

describe('the inline layer shorthand', () => {
	test('takes no bindings on a form or checklist builder', () => {
		expectTypeOf<Parameters<FormBuilderInterface['inlineLayer']>[1]>().not.toHaveProperty('bindings')
		expectTypeOf<Parameters<ChecklistBuilderInterface['inlineLayer']>[1]>().not.toHaveProperty('bindings')
		expectTypeOf<Parameters<FormBuilderInterface['fileLayer']>[1]>().toHaveProperty('bindings')
	})
})
