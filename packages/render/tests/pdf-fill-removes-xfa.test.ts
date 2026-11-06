import type { Form } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { extractPdfData, renderPdf } from '../src/pdf'
import { PdfModel } from '../src/pdf/syntax'
import { acroFormPdf } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'xfa-fixture',
  version: '1.0.0',
  title: 'XFA fixture',
  fields: { fullName: { type: 'text', label: 'Full name' } },
} as unknown as Form

const bindings = { full_name: 'fullName' }
const data = { fields: { fullName: 'Ada Lovelace' } }

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

async function formEntries(pdf: Uint8Array) {
  const model = await PdfModel.load(pdf)
  const catalog = model.catalog()
  const catalogDict = model.dict(catalog?.value)
  const acroForm = model.dict(catalogDict?.entries.get('AcroForm'))
  return { catalog: catalogDict!, acroForm: acroForm! }
}

describe('filling a PDF that carries an XFA form', () => {
  it('drops the XFA form and the request to render it, so viewers show the filled AcroForm', async () => {
    const template = acroFormPdf([{ kind: 'text', name: 'full_name' }], { xfa: true })
    const before = await formEntries(template)
    expect(before.acroForm.entries.has('XFA')).toBe(true)
    expect(before.catalog.entries.has('NeedsRendering')).toBe(true)

    const filled = await renderPdf({ template, form, data, bindings })
    const after = await formEntries(filled)

    expect(after.acroForm.entries.has('XFA')).toBe(false)
    expect(after.catalog.entries.has('NeedsRendering')).toBe(false)
    expect((await inspectAcroFormFields(filled)).find((field) => field.name === 'full_name')?.value).toBe('Ada Lovelace')
  })

  it('writes the file whole, so no XFA bytes and no earlier revision stay in it', async () => {
    const template = acroFormPdf([{ kind: 'text', name: 'full_name' }], { xfa: true })
    expect(latin1(template)).toContain('<xdp:xdp')

    const filled = await renderPdf({ template, form, data, bindings })

    expect(latin1(filled)).not.toContain('<xdp:xdp')
    expect(latin1(filled)).not.toContain('/XFA')
    expect(latin1(filled).match(/%%EOF/g)).toHaveLength(1)
    const read = await extractPdfData({ pdf: filled, form, bindings })
    expect(read.data.fields).toEqual({ fullName: 'Ada Lovelace' })
  })

  it('fills a PDF with no XFA form as an incremental update, as before', async () => {
    const template = acroFormPdf([{ kind: 'text', name: 'full_name' }])
    const filled = await renderPdf({ template, form, data, bindings })
    const after = await formEntries(filled)

    expect(filled.slice(0, template.length)).toEqual(template)
    expect(after.acroForm.entries.has('XFA')).toBe(false)
    expect(after.acroForm.entries.get('Fields')).toBeDefined()
    expect((await inspectAcroFormFields(filled)).find((field) => field.name === 'full_name')?.value).toBe('Ada Lovelace')
  })
})
