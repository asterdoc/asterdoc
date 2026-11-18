import { describe, expect, it } from 'vitest'
import { validateLayers } from '@/index'

const encoder = new TextEncoder()

function narrowFieldsPdf(names: string[]): Uint8Array {
	const refs = names.map((_, index) => `${index + 4} 0 R`).join(' ')
	const objects = [
		`<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${refs}] /DA (/Helv 0 Tf 0 g) >> >>`,
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [${refs}] >>`,
		...names.map((name, index) => `<< /FT /Tx /T (${name}) /Subtype /Widget /Rect [20 ${700 - index * 30} ${80 + index * 60} ${714 - index * 30}] /P 3 0 R /DA (/Helv 10 Tf 0 g) >>`),
	]
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

const template = narrowFieldsPdf(['city', 'note'])

const form = (city: string, note: string) => ({
	kind: 'form' as const,
	name: 'defaults',
	version: '1.0.0',
	title: 'Defaults',
	fields: {
		city: { type: 'text' as const, label: 'City', maxLength: 10, default: city },
		office: { type: 'fieldset' as const, label: 'Office', fields: { note: { type: 'text' as const, label: 'Note', maxLength: 25, default: note } } },
	},
	layers: { pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'defaults.pdf', bindings: { city: 'city', note: 'office.note' } } },
	defaultLayer: 'pdf',
})

const issues = async (city: string, note: string) =>
	(await validateLayers(form(city, note), { resolver: { read: async () => template } })).issues ?? []

describe('a PDF layer and the defaults of the fields it prints', () => {
	it('accepts defaults the layer can print', async () => {
		expect(await issues('Lyon', 'Front')).toEqual([])
	})

	it('refuses a default with a character the field\'s font cannot draw, naming the field, the layer and the cause', async () => {
		expect(await issues('Zażółć', 'Front')).toEqual([{
			message: expect.stringMatching(/^Layer "pdf", the default of fields\.city: the layer cannot print it\. .*"city".*no available font can draw "ż"/),
			path: ['fields', 'city', 'default'],
			severity: 'error',
		}])
	})

	it('refuses a default too long for its field, at its place in a field set', async () => {
		expect(await issues('Lyon', 'W'.repeat(25))).toEqual([{
			message: expect.stringMatching(/^Layer "pdf", the default of fields\.office\.note: the layer cannot print it\. .*"note"/),
			path: ['fields', 'office', 'fields', 'note', 'default'],
			severity: 'error',
		}])
	})
})
