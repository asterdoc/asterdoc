import { describe, expect, it } from 'vitest'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { inspectAcroFormFields } from '@asterdoc/render/pdf'
import { createLayerRenderer } from '@asterdoc/render'
import { form, RenderRefusedError, UnboundResolverError } from '@/index'
import { acroFormPdf } from './fixtures/text-fields-pdf'

const resolver = createMemoryResolver({
	contents: {
		'wide.pdf': acroFormPdf([{ name: 'name', width: 300, height: 14 }, { name: 'code', width: 300, height: 14 }]),
		'narrow.pdf': acroFormPdf([{ name: 'name', width: 60, height: 14 }, { name: 'code', width: 300, height: 14 }]),
		'summary.md': new TextEncoder().encode('Name: {{fields.name}}'),
	},
})

const definition = {
	kind: 'form' as const,
	name: 'applicant',
	version: '1.0.0',
	title: 'Applicant',
	fields: {
		name: { type: 'text' as const, label: 'Name', maxLength: 60 },
		code: { type: 'text' as const, label: 'Code', maxLength: 10 },
	},
	defaultLayer: 'wide',
	layers: {
		wide: { kind: 'file' as const, mimeType: 'application/pdf', path: 'wide.pdf', bindings: { name: 'name', code: 'code' } },
		narrow: { kind: 'file' as const, mimeType: 'application/pdf', path: 'narrow.pdf', bindings: { name: 'name', code: 'code' } },
		summary: { kind: 'file' as const, mimeType: 'text/markdown', path: 'summary.md' },
	},
}

const LONG = 'Maximilian Alexander von Hohenzollern'

const draftOf = async (fields: Record<string, unknown>) =>
	(await form.load(definition, { resolver })).fill({ fields })

describe('data validation reads no layer', () => {
	it('takes a value that matches the artifact, however it prints', async () => {
		for (const name of [LONG, '王小明', 'محمد', 'Հայ']) expect((await draftOf({ name })).validate().errors, name).toEqual([])
	})

	it('still refuses a value the artifact refuses', async () => {
		const loaded = await form.load(definition, { resolver })
		const refused = loaded.safeFill({ fields: { code: 'X'.repeat(11) } })
		expect(refused.success).toBe(false)
		expect(refused.success ? undefined : refused.error.message).toContain('Must be at most 10')
	})

	it('validates a form with only a text layer without any PDF check', async () => {
		const textOnly = { ...definition, defaultLayer: 'summary', layers: { summary: definition.layers.summary } }
		const draft = (await form.load(textOnly, { resolver })).fill({ fields: { name: LONG } })
		expect(draft.validate().errors).toEqual([])
		expect(draft.renderProblems()).toEqual([])
		expect(await draft.render()).toBe(`Name: ${LONG}`)
	})
})

describe('the render check of a layer', () => {
	it('passes data the standard fonts draw: the Windows Latin 1 characters', async () => {
		for (const name of ['Ada', 'Crème brûlée', 'Zoë Ñúñez']) expect((await draftOf({ name })).renderProblems('wide'), name).toEqual([])
	})

	it('reports a value too wide for its box on that layer only, naming the layer, the PDF field and the path', async () => {
		const draft = await draftOf({ name: LONG })
		expect(draft.renderProblems('wide')).toEqual([])
		expect(draft.renderProblems('narrow')).toEqual([expect.objectContaining({
			field: 'fields.name',
			code: 'unprintable',
			layer: 'narrow',
			pdfField: 'name',
			message: expect.stringContaining('does not fit at the minimum size'),
		})])
	})

	it('reports a character the standard font does not have, and a script that needs shaping', async () => {
		expect((await draftOf({ name: '王小明' })).renderProblems('wide')[0]?.message)
			.toContain('Layer "wide": Cannot fill PDF field "name" with fields.name: no available font can draw "王"')
		for (const [name, character] of [['Жуковский', 'Ж'], ['Ωμέγα', 'Ω'], ['Łódź', 'Ł'], ['Dvořák', 'ř']]) {
			expect((await draftOf({ name })).renderProblems('wide')[0]?.message, name).toContain(`no available font can draw "${character}"`)
		}
		expect((await draftOf({ name: 'محمد' })).renderProblems('wide')[0]?.message).toContain('the value contains Arabic script ("م", U+0645)')
	})

	it('refuses a layer the form does not have', async () => {
		await expect((async () => (await draftOf({})).renderProblems('missing'))()).rejects.toThrow('Layer "missing" not found')
	})
})

describe('the standard font the artifact chooses', () => {
	const narrow = (layer: Record<string, unknown>) => ({
		...definition,
		defaultLayer: 'narrow',
		layers: { narrow: { kind: 'file' as const, mimeType: 'application/pdf', path: 'narrow.pdf', bindings: { name: 'name' }, ...layer } },
	})
	const thin = 'i'.repeat(20)
	const problemsWith = async (layer: Record<string, unknown>) => (await form.load(narrow(layer), { resolver })).fill({ fields: { name: thin } }).renderProblems()

	it('measures in Helvetica by default, where a run of narrow letters fits', async () => {
		expect(await problemsWith({})).toEqual([])
	})

	it('measures in Courier when the layer chooses it, and refuses what does not fit', async () => {
		expect((await problemsWith({ font: 'Courier' }))[0]?.message).toContain('does not fit at the minimum size')
	})

	it('measures in Courier when the binding chooses it', async () => {
		expect((await problemsWith({ bindings: { name: { path: 'name', font: 'Courier' } } }))[0]?.message).toContain('does not fit at the minimum size')
	})

	const latin1 = new TextDecoder('latin1')
	const drawn = async (layer: Record<string, unknown>, name: string) =>
		latin1.decode(await (await form.load(narrow(layer), { resolver })).fill({ fields: { name } }).render({ renderer: createLayerRenderer() }) as Uint8Array)

	it('draws in Helvetica when the artifact gives no font', async () => {
		const pdf = await drawn({}, thin)
		expect(pdf).toContain('/BaseFont /Helvetica')
		expect(pdf).not.toContain('/BaseFont /Courier')
	})

	it('draws in Courier when the layer or the binding chooses it', async () => {
		for (const layer of [{ font: 'Courier' }, { bindings: { name: { path: 'name', font: 'Courier' } } }]) {
			const pdf = await drawn(layer, 'Ada')
			expect(pdf).toContain('/BaseFont /Courier')
			expect(pdf).not.toContain('/BaseFont /Helvetica')
		}
	})

	it('refuses to render, with the render check\'s report, a value that fits in Helvetica but not in the Courier the layer chooses', async () => {
		const draft = (await form.load(narrow({ font: 'Courier' }), { resolver })).fill({ fields: { name: thin } })
		expect(draft.isValid()).toBe(true)
		const refused = await draft.render({ renderer: createLayerRenderer() }).then(() => undefined, (error: unknown) => error)
		expect(refused).toBeInstanceOf(RenderRefusedError)
		expect((refused as RenderRefusedError).problems).toEqual(draft.renderProblems())
		await expect(drawn({}, thin)).resolves.toContain('/BaseFont /Helvetica')
	})
})

describe('names in Latin 1 and in other scripts, with the standard fonts', () => {
	it.each(['José', 'Müller', 'François'])('%s is valid, passes the render check and prints', async (name) => {
		const draft = await draftOf({ name })
		expect(draft.validate().errors).toEqual([])
		expect(draft.renderProblems('wide')).toEqual([])
		const pdf = await draft.render({ layer: 'wide', renderer: createLayerRenderer() }) as Uint8Array
		expect((await inspectAcroFormFields(pdf)).find((field) => field.name === 'name')?.value).toBe(name)
	})

	it.each([
		['Łukasz', 'Ł'],
		['李', '李'],
		['Иванов', 'И'],
		['محمد', 'م'],
	])('%s is valid, and the render check refuses it naming the field, the layer and the character; render refuses with the same report', async (name, character) => {
		const draft = await draftOf({ name })
		expect(draft.validate().errors).toEqual([])
		const problems = draft.renderProblems('wide')
		expect(problems).toEqual([expect.objectContaining({ field: 'fields.name', layer: 'wide', pdfField: 'name', code: 'unprintable', message: expect.stringContaining(`"${character}"`) })])
		const refused = await draft.render({ layer: 'wide', renderer: createLayerRenderer() }).then(() => undefined, (error: unknown) => error)
		expect(refused).toBeInstanceOf(RenderRefusedError)
		expect((refused as RenderRefusedError).problems).toEqual(problems)
	})
})

describe('a render', () => {
	it('draws data the render check passes', async () => {
		const draft = await draftOf({ name: 'Crème brûlée', code: 'A1' })
		expect(draft.renderProblems()).toEqual([])
		const pdf = await draft.render({ renderer: createLayerRenderer() }) as Uint8Array
		expect((await inspectAcroFormFields(pdf)).find((field) => field.name === 'name')?.value).toBe('Crème brûlée')
	})

	it('refuses valid data before drawing, with the report the render check gives', async () => {
		const draft = await draftOf({ name: LONG })
		expect(draft.isValid()).toBe(true)
		const refused = await draft.render({ layer: 'narrow', renderer: createLayerRenderer() }).then(() => undefined, (error: unknown) => error)
		expect(refused).toBeInstanceOf(RenderRefusedError)
		expect((refused as RenderRefusedError).problems).toEqual(draft.renderProblems('narrow'))
		expect((refused as RenderRefusedError).message).toBe(`Cannot render layer "narrow": ${draft.renderProblems('narrow')[0]!.message.replace('Layer "narrow": ', '')}`)
	})

	it('refuses the same way when the form itself renders data, without a draft', async () => {
		const loaded = await form.load(definition, { resolver })
		await expect(loaded.render({ layer: 'narrow', data: { fields: { name: LONG } }, renderer: createLayerRenderer() })).rejects.toBeInstanceOf(RenderRefusedError)
	})

	it('cannot load a form whose PDF layer it cannot read', async () => {
		await expect(form.load(definition)).rejects.toThrow(UnboundResolverError)
	})
})
