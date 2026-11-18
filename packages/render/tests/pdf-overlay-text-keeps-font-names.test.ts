import { describe, expect, it } from 'vitest'
import { renderPdf } from '../src/pdf'
import { assemblePdf, pagePdf } from './pdf-fixtures'

function pageWithFontNamed(name: string): Uint8Array {
  return assemblePdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /${name} 4 0 R >> >> >>` },
    { id: 4, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>' },
  ])
}

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

async function shown(template: Uint8Array, text: string): Promise<{ font: string; text: string }> {
  const content = latin1(await renderPdf({ template, data: {}, overlays: [{ page: 1, x: 10, y: 100, text }] }))
  const match = /BT\n[^\n]*rg\n[^\n]*Td\n\/(\S+) 12 Tf\n\((.*)\) Tj\nET/.exec(content)
  return { font: match?.[1] ?? '', text: match?.[2] ?? '' }
}

describe('the text of an overlay', () => {
  it('prints as given on a page whose font names do not clash with the overlay font', async () => {
    expect(await shown(pagePdf([[300, 300]]), 'Paid /PdrFontHelvetica in full')).toEqual({ font: 'PdrFontHelvetica', text: 'Paid /PdrFontHelvetica in full' })
  })

  it('prints as given when the overlay font takes a new name because the page already uses its name', async () => {
    const result = await shown(pageWithFontNamed('PdrFontHelvetica'), 'Paid /PdrFontHelvetica in full')
    expect(result.font).not.toBe('PdrFontHelvetica')
    expect(result.font).toMatch(/^PdrFontHelvetica/)
    expect(result.text).toBe('Paid /PdrFontHelvetica in full')
  })
})
