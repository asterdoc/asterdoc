const encoder = new TextEncoder()

/** A one-page PDF with a text field for each of `fields`, or none. */
export function blankPdf(fields: readonly string[] = []): Uint8Array {
  const refs = fields.map((_, index) => `${index + 4} 0 R`).join(' ')
  const bodies = [
    fields.length > 0 ? `<< /Type /Catalog /Pages 2 0 R /AcroForm ${fields.length + 4} 0 R >>` : '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >>${fields.length > 0 ? ` /Annots [${refs}]` : ''} >>`,
    ...fields.map((name, index) => `<< /FT /Tx /T (${name}) /Subtype /Widget /Rect [20 ${700 - index * 20} 300 ${714 - index * 20}] /P 3 0 R /DA (/Helv 10 Tf 0 g) >>`),
    ...(fields.length > 0 ? [`<< /Fields [${refs}] >>`] : []),
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

/** Where an inline artifact's file layers are read from in a test. */
export const PDF_FILES_URL = 'https://files.asterdoc.dev/'

/** Serves a PDF with a text field for each of `fields` for every `.pdf` path under PDF_FILES_URL. */
export function pdfFilesWith(fields: readonly string[]) {
  return {
    fetch: (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      return url.startsWith(PDF_FILES_URL) && url.endsWith('.pdf') ? new Response(blankPdf(fields)) : new Response('Not found', { status: 404 })
    }) as typeof globalThis.fetch,
  }
}

/** Serves a blank PDF for every `.pdf` path under PDF_FILES_URL, so a form whose PDF layer a test never fills loads. */
export const pdfFiles = pdfFilesWith([])
