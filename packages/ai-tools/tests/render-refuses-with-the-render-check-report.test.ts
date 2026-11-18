import { describe, expect, it } from 'vitest'
import { executeFill, executeRender } from '../src'

function narrowPdf(): Uint8Array<ArrayBuffer> {
	const bodies = [
		'<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [4 0 R] >>',
		'<< /FT /Tx /T (name) /Subtype /Widget /Rect [20 700 80 714] /P 3 0 R /DA (/Helv 10 Tf 0 g) >>',
		'<< /Fields [4 0 R] >>',
	]
	let pdf = '%PDF-1.5\n'
	const offsets: number[] = []
	bodies.forEach((body, index) => {
		offsets.push(pdf.length)
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
	})
	const xref = pdf.length
	pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
	pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return new TextEncoder().encode(pdf) as Uint8Array<ArrayBuffer>
}

const config = { fetch: (async () => new Response(narrowPdf())) as typeof globalThis.fetch }
const source = {
	source: 'artifact' as const,
	base_url: 'https://files.asterdoc.dev/applicant/',
	artifact: {
		kind: 'form',
		name: 'applicant',
		version: '1.0.0',
		title: 'Applicant',
		fields: { name: { type: 'text', label: 'Name', required: true, maxLength: 80 } },
		layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'form.pdf', bindings: { name: 'name' } } },
		defaultLayer: 'pdf',
	},
}

describe('the render tool and the render check', () => {
	it('renders a value that fits its field', async () => {
		expect(await executeRender({ ...source, data: { fields: { name: 'Ada' } } }, config)).toMatchObject({ success: true, mime_type: 'application/pdf' })
	})

	it('calls a long value complete, and refuses to render it with the render check\'s report', async () => {
		const data = { fields: { name: 'Maximilian Alexander von Hohenzollern' } }
		expect(await executeFill({ ...source, data }, config)).toMatchObject({ accepted: true, complete: true })
		const result = await executeRender({ ...source, data }, config)
		expect(result).toMatchObject({
			success: false,
			error: { code: 'render_refused' },
			errors: [expect.objectContaining({ code: 'unprintable', path: ['fields', 'name'], message: expect.stringContaining('does not fit at the minimum size') })],
		})
	})
})
