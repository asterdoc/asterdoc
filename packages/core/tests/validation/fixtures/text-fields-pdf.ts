const encoder = new TextEncoder()

export interface TextBox {
  name: string
  width: number
  height: number
  flags?: number
  maxLen?: number
}

/** A one-page PDF whose AcroForm holds the given text fields. */
export function acroFormPdf(boxes: TextBox[]): Uint8Array {
  const fieldIds = boxes.map((_, index) => index + 4)
  const acroFormId = boxes.length + 4
  const bodies = [
    `<< /Type /Catalog /Pages 2 0 R /AcroForm ${acroFormId} 0 R >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [${fieldIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
    ...boxes.map((box) => [
      `<< /FT /Tx /T (${box.name}) /Subtype /Widget /Rect [20 20 ${20 + box.width} ${20 + box.height}] /P 3 0 R`,
      box.flags === undefined ? '' : ` /Ff ${box.flags}`,
      box.maxLen === undefined ? '' : ` /MaxLen ${box.maxLen}`,
      ' >>',
    ].join('')),
    `<< /Fields [${fieldIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  ]
  let pdf = '%PDF-1.5\n'
  const offsets: number[] = []
  bodies.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return encoder.encode(pdf)
}
