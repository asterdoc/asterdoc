import { describe, expect, it } from 'vitest'
import { validateLayers } from '@/index'

const encoder = new TextEncoder()

function pdf(objects: string[]): Uint8Array {
	let text = '%PDF-1.5\n'
	const offsets: number[] = []
	objects.forEach((body, index) => {
		offsets.push(text.length)
		text += `${index + 1} 0 obj\n${body}\nendobj\n`
	})
	const xref = text.length
	text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
	text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return encoder.encode(text)
}

const widget = (page: number, y: number, extra = '') => `<< /Type /Annot /Subtype /Widget /Rect [20 ${y} 300 ${y + 14}] /P ${page} 0 R${extra} >>`

const shared = (type: 'Tx' | 'Ch') => pdf([
	'<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 0 Tf 0 g) >> >>',
	'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
	'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [6 0 R] >>',
	'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [7 0 R] >>',
	`<< /FT /${type} /T (title) /Kids [6 0 R 7 0 R]${type === 'Ch' ? ' /Ff 131072 /Opt [(A) (B)]' : ''} >>`,
	widget(3, 700, ' /Parent 5 0 R'),
	widget(4, 600, ' /Parent 5 0 R'),
])

const split = pdf([
	'<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R] /DA (/Helv 0 Tf 0 g) >> >>',
	'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
	'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [5 0 R] >>',
	'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [6 0 R] >>',
	widget(3, 700, ' /FT /Tx /T (title)'),
	widget(4, 600, ' /FT /Tx /T (renewalTitle)'),
])

const form = (bindings: Record<string, string>) => ({
	kind: 'form' as const,
	name: 'titles',
	version: '1.0.0',
	title: 'Titles',
	fields: { title: { type: 'text' as const, label: 'Title', maxLength: 20 }, renewalTitle: { type: 'text' as const, label: 'Renewal title', maxLength: 20 } },
	layers: { pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'titles.pdf', bindings } },
	defaultLayer: 'pdf',
})

const issues = async (template: Uint8Array, bindings: Record<string, string>) =>
	((await validateLayers(form(bindings), { resolver: { read: async () => template } })).issues ?? []).map((issue) => issue.message)

const REFUSED = 'Layer "pdf", binding "title": the PDF field "title" in "titles.pdf" has 2 widgets, on pages 1 and 2, and a value prints in every one of them. Split the field in the PDF into one field per widget, so each place takes its own value.'

describe('a bound PDF field with more than one widget', () => {
	it('is refused for a text field, naming the field and its pages', async () => {
		expect(await issues(shared('Tx'), { title: 'title' })).toEqual([REFUSED])
	})

	it('is refused for a choice field', async () => {
		expect(await issues(shared('Ch'), { title: 'title' })).toContain(REFUSED)
	})

	it('is accepted once each widget is its own field', async () => {
		expect(await issues(split, { title: 'title', renewalTitle: 'renewalTitle' })).toEqual([])
	})

	it('is no concern while no binding fills it', async () => {
		expect(await issues(shared('Tx'), {})).toEqual([])
	})
})
