import { describe, expect, it } from 'vitest'
import { pdfBindingPages, PdfBindingSyntaxError } from '../src/pdf'
import { assemblePdf, pagePdf } from './pdf-fixtures'

const twoPages = assemblePdf([
  { id: 1, body: '<< /Type /Catalog /Pages 2 0 R /AcroForm 12 0 R >>' },
  { id: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>' },
  { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Annots [5 0 R 6 0 R 10 0 R] >>' },
  { id: 4, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Annots [7 0 R 8 0 R 11 0 R] >>' },
  { id: 5, body: '<< /FT /Tx /T (name) /Subtype /Widget /Rect [20 20 120 40] /P 3 0 R >>' },
  { id: 6, body: '<< /FT /Tx /T (city) /Subtype /Widget /Rect [20 60 120 80] /P 3 0 R >>' },
  { id: 7, body: '<< /FT /Tx /T (receipt) /Subtype /Widget /Rect [20 20 120 40] >>' },
  { id: 8, body: '<< /FT /Btn /T (agree) /Subtype /Widget /Rect [20 60 40 80] /P 4 0 R >>' },
  { id: 9, body: '<< /FT /Tx /T (total) /Kids [10 0 R 11 0 R] >>' },
  { id: 10, body: '<< /Parent 9 0 R /Subtype /Widget /Rect [20 100 120 120] /P 3 0 R >>' },
  { id: 11, body: '<< /Parent 9 0 R /Subtype /Widget /Rect [20 100 120 120] /P 4 0 R >>' },
  { id: 12, body: '<< /Fields [5 0 R 6 0 R 7 0 R 8 0 R 9 0 R] >>' },
])

describe('pdfBindingPages', () => {
  it('gives the page of each bound path, without the fields root', async () => {
    const pages = await pdfBindingPages({ template: twoPages, bindings: { name: 'fields.name', agree: 'agree', receipt: 'parties.client.name' } })
    expect([...pages]).toEqual([['name', [1]], ['agree', [2]], ['parties.client.name', [2]]])
  })

  it('reads the page from the page that lists a widget when the widget does not name its page', async () => {
    expect((await pdfBindingPages({ template: twoPages, bindings: { receipt: 'receiptNumber' } })).get('receiptNumber')).toEqual([2])
  })

  it('gives every page of a field with a widget on each', async () => {
    expect((await pdfBindingPages({ template: twoPages, bindings: { total: 'total' } })).get('total')).toEqual([1, 2])
  })

  it('gives every page a path prints on, across bindings, in page order', async () => {
    const pages = await pdfBindingPages({ template: twoPages, bindings: { agree: 'status:yes', name: 'status:no', receipt: 'ssn:1', city: 'ssn:2' } })
    expect(pages.get('status')).toEqual([1, 2])
    expect(pages.get('ssn')).toEqual([1, 2])
  })

  it('gives each path a template prints the page of its field', async () => {
    const pages = await pdfBindingPages({ template: twoPages, bindings: { receipt: { template: '{{fields.home.locality}}, {{fields.home.region}}' }, name: { path: 'home.line1' } } })
    expect([...pages]).toEqual([['home.locality', [2]], ['home.region', [2]], ['home.line1', [1]]])
  })

  it('leaves out a binding whose field the PDF does not have, and a PDF with no form', async () => {
    expect([...(await pdfBindingPages({ template: twoPages, bindings: { missing: 'name' } }))]).toEqual([])
    expect([...(await pdfBindingPages({ template: pagePdf([[300, 300]]), bindings: { name: 'name' } }))]).toEqual([])
  })

  it('refuses a binding it cannot parse', async () => {
    await expect(pdfBindingPages({ template: twoPages, bindings: { name: 'first, last' } })).rejects.toThrow(PdfBindingSyntaxError)
  })
})
