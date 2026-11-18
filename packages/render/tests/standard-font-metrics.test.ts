import { describe, expect, it } from 'vitest'
import { standardFonts } from '../src/pdf/standard-font'
import { parseBinding, PdfBindingSyntaxError } from '../src/layer-bindings'

describe('the standard font metrics, from the Adobe font metrics', () => {
  it('give Courier its ascender and descender, and 600 for every character', () => {
    expect(standardFonts.Courier.ascent).toBe(629)
    expect(standardFonts.Courier.descent).toBe(-157)
    expect(standardFonts.Courier.width('Wil ÿ')).toBe(3000)
  })

  it('give Helvetica its ascender and descender, and each character its own width', () => {
    expect(standardFonts.Helvetica.ascent).toBe(718)
    expect(standardFonts.Helvetica.descent).toBe(-207)
    expect(standardFonts.Helvetica.width('Wi')).toBe(944 + 222)
  })

  it('give the Helvetica Ÿ the width of Y, and ÿ the width of y', () => {
    expect(standardFonts.Helvetica.width('Ÿ')).toBe(standardFonts.Helvetica.width('Y'))
    expect(standardFonts.Helvetica.width('Ÿ')).toBe(667)
    expect(standardFonts.Helvetica.width('ÿ')).toBe(500)
  })
})

describe('the font of a binding object', () => {
  it.each(['Helvetica', 'Courier'])('takes the standard font %s', (font) => {
    expect(parseBinding({ path: 'fields.name', font } as never)).toMatchObject({ font })
  })

  it.each(['Times-Roman', 'helvetica', 12])('refuses %s, naming the two fonts it takes', (font) => {
    expect(() => parseBinding({ path: 'fields.name', font } as never)).toThrow(PdfBindingSyntaxError)
    expect(() => parseBinding({ path: 'fields.name', font } as never)).toThrow('has a font that is neither "Helvetica" nor "Courier"')
  })
})
