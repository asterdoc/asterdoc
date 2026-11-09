import { describe, expect, it } from 'vitest'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { validate, validateLayers } from '@/index'

const encoder = new TextEncoder()
const COMB = 1 << 24

function combPdf(name: string, maxLen: number): Uint8Array {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [4 0 R] >>',
    `<< /FT /Tx /T (${name}) /Subtype /Widget /Rect [20 20 220 34] /P 3 0 R /Ff ${COMB} /MaxLen ${maxLen} >>`,
    '<< /Fields [4 0 R] >>',
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

const resolver = createMemoryResolver({ contents: { 'phone.pdf': combPdf('phone', 10), 'kind.pdf': combPdf('kind', 10) } })

function artifact(fields: Record<string, unknown>, path: string, layer: Record<string, unknown>) {
  return {
    kind: 'form',
    name: 'formats',
    version: '1.0.0',
    title: 'Formats',
    fields,
    layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path, ...layer } },
  }
}

describe('validateLayers with phone, choice and boolean formats', () => {
  it('checks fit at the output the layer format prints', async () => {
    const phone = { phone: { type: 'phone', label: 'Phone' } }
    const bounded = await validateLayers(artifact(phone, 'phone.pdf', { bindings: { phone: 'phone.number' }, format: { phone: { style: 'digits', region: 'US' } } }), { resolver })
    expect(bounded.issues).toBeUndefined()
    const open = await validateLayers(artifact(phone, 'phone.pdf', { bindings: { phone: 'phone.number' }, format: { phone: { style: 'digits' } } }), { resolver })
    expect(open.issues).toEqual([expect.objectContaining({ path: ['layers', 'pdf', 'bindings', 'phone'], severity: 'error', message: expect.stringContaining('10 comb boxes') })])
    const whole = await validateLayers(artifact(phone, 'phone.pdf', { bindings: { phone: 'phone' }, format: { phone: { style: 'digits', region: 'US' } } }), { resolver })
    expect(whole.issues).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringContaining('with an extension of 20 digits') })])
  })

  it('warns, without failing, about labels reading the PDF back cannot tell apart', async () => {
    const kind = { kind: { type: 'enum', label: 'Kind', enum: [{ value: 'a', label: 'Same' }, { value: 'b', label: 'Same' }] } }
    const labelled = await validateLayers(artifact(kind, 'kind.pdf', { bindings: { kind: 'kind' }, format: { choice: { display: 'label' } } }), { resolver })
    expect(labelled.issues).toBeUndefined()
    expect(labelled.warnings).toEqual([expect.objectContaining({
      path: ['layers', 'pdf', 'bindings', 'kind'],
      severity: 'warning',
      message: expect.stringContaining('all print the label "Same"'),
    })])
    const byValue = await validateLayers(artifact(kind, 'kind.pdf', { bindings: { kind: 'kind' } }), { resolver })
    expect(byValue.warnings).toBeUndefined()
  })

  it('warns about equal boolean labels on a layer that fills by field id', async () => {
    const result = await validateLayers(artifact({ kind: { type: 'boolean', label: 'Kind' } }, 'kind.pdf', { format: { boolean: { trueLabel: 'X', falseLabel: 'X' } } }), { resolver })
    expect(result.warnings).toEqual([expect.objectContaining({ path: ['layers', 'pdf', 'format'], message: expect.stringContaining('print "X" and "X", equal apart from space and case') })])
  })

  it('accepts the new keys in the schema, and refuses values outside them', () => {
    const fields = { phone: { type: 'phone', label: 'Phone' } }
    const layer = (format: unknown) => artifact(fields, 'phone.pdf', { format })
    expect(validate(layer({ phone: { style: 'national', region: 'US' }, choice: { display: 'label' }, boolean: { trueLabel: 'Yes', falseLabel: '' } })).issues).toBeUndefined()
    expect(validate(layer({ phone: { style: 'local' } })).issues).toBeDefined()
    expect(validate(layer({ phone: { region: 'us' } })).issues).toBeDefined()
    expect(validate(layer({ choice: { display: 'code' } })).issues).toBeDefined()
    expect(validate(layer({ boolean: { trueLabel: 1 } })).issues).toBeDefined()
  })
})
