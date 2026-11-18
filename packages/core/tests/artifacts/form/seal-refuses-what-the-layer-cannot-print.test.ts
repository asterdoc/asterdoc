import { describe, expect, test } from 'vitest'
import { a, RenderRefusedError } from '@/index'
import { fieldsPdf, pdfFiles } from '../../support/pdf-files'

const definition = {
	kind: 'form' as const,
	name: 'sealed-form',
	version: '1.0.0',
	title: 'Sealed form',
	fields: { name: { type: 'text' as const, label: 'Name', maxLength: 400 } },
	parties: { signer: { label: 'Signer', partyType: 'person' as const, signature: { required: true } } },
	layers: {
		pdf: {
			kind: 'file' as const,
			mimeType: 'application/pdf',
			path: 'form.pdf',
			bindings: { name: 'name' },
			signatures: {
				signature: { party: { role: 'signer' }, type: 'signature' as const, placement: { page: 1, x: 50, y: 50, width: 120, height: 30 } },
			},
		},
	},
	defaultLayer: 'pdf',
}

const signed = async (name: string) =>
	(await a.form.load(definition, { resolver: pdfFiles({ 'form.pdf': fieldsPdf(['name']) }) }))
		.fill({ fields: { name }, parties: { signer: { id: 'signer-0', name: 'Ada Lovelace' } } })
		.addSigner('ada', { person: { name: 'Ada Lovelace' } })
		.addSignatory('signer', 'signer-0', { signerId: 'ada' })

const LONG = 'W'.repeat(300)

describe('seal and prepareSeal on a PDF layer', () => {
	test('seal and prepare data that prints', async () => {
		expect((await (await signed('Ada Lovelace')).seal()).canonicalPdfHash).toMatch(/^sha256:/)
		expect(await (await signed('Ada Lovelace')).prepareSeal()).toBeDefined()
	})

	test.each([
		['seal', (form: Awaited<ReturnType<typeof signed>>) => form.seal()],
		['prepareSeal', (form: Awaited<ReturnType<typeof signed>>) => form.prepareSeal()],
	])('%s refuses valid data the layer cannot print, with the render check\'s report', async (_name, run) => {
		const form = await signed(LONG)
		expect(form.isValid()).toBe(true)
		const refusal = await run(form).then(() => undefined, (error: unknown) => error)
		expect(refusal).toBeInstanceOf(RenderRefusedError)
		expect(refusal).toMatchObject({ layer: 'pdf', problems: [expect.objectContaining({ field: 'fields.name', code: 'unprintable', pdfField: 'name' })] })
		expect((refusal as RenderRefusedError).problems).toEqual(form.renderProblems('pdf'))
	})
})
