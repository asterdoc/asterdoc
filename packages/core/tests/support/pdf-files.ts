import type { Resolver } from '@asterdoc/types'

const encoder = new TextEncoder()

export function blankPdf(): Uint8Array {
	const bodies = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>',
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
	return encoder.encode(pdf)
}

export function fieldsPdf(names: readonly string[]): Uint8Array {
	const literal = (value: string) => `(${value.replace(/[\\()]/g, (char) => `\\${char}`)})`
	const widgets = names.map((name, index) =>
		`<< /FT /Tx /T ${literal(name)} /Subtype /Widget /Rect [20 ${740 - index * 20} 300 ${754 - index * 20}] /P 3 0 R /DA (/Helv 10 Tf 0 g) >>`)
	const first = 4
	const refs = widgets.map((_, index) => `${first + index} 0 R`).join(' ')
	const bodies = [
		`<< /Type /Catalog /Pages 2 0 R /AcroForm ${first + widgets.length} 0 R >>`,
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [${refs}] >>`,
		...widgets,
		`<< /Fields [${refs}] >>`,
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
	return encoder.encode(pdf)
}

export function pdfFiles(contents: Record<string, Uint8Array | string> = {}, fields: readonly string[] = []): Resolver {
	return {
		read: async (path) => {
			const own = contents[path] ?? contents[path.replace(/^\.\//, '')]
			if (own !== undefined) return typeof own === 'string' ? encoder.encode(own) : own
			if (path.toLowerCase().endsWith('.pdf')) return fields.length > 0 ? fieldsPdf(fields) : blankPdf()
			throw new Error(`No file at ${path}`)
		},
	}
}
