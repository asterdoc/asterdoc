import type { Form, RenderRequest, RendererLayer } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { flattenPdf, pdfFontCheck, PdfFieldFillError, renderPdf, type PdfFont, type RenderPdfOptions } from '../src/pdf'
import { liberationSans, syntheticFont } from './font-fixtures'
import { acroFieldsPdf, pagePdf, type FixtureField } from './pdf-fixtures'
import { textItemsWithPdfjs } from './pdfjs-reference'

const liberation: PdfFont = { bytes: liberationSans(), source: 'fonts/LiberationSans-Regular.ttf' }

const box = (name: string, overrides: Partial<FixtureField> = {}): FixtureField => ({
  name,
  rect: [100, 600, 400, 620],
  da: '/Helv 10 Tf 0 g',
  ...overrides,
})

async function refusal(options: RenderPdfOptions): Promise<PdfFieldFillError> {
  const error = await renderPdf(options).then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(PdfFieldFillError)
  return error as PdfFieldFillError
}

async function drawnText(options: RenderPdfOptions): Promise<string> {
  const items = await textItemsWithPdfjs(await flattenPdf(await renderPdf(options)))
  return items.map((item) => item.text).join('')
}

describe('a value no font can draw', () => {
  const nativeName: RenderPdfOptions = {
    template: acroFieldsPdf([box('TextField20[1]')]),
    data: { fields: { nameInNativeAlphabet: '王小明' } },
    bindings: { 'TextField20[1]': 'nameInNativeAlphabet' },
  }

  it('is refused with the artifact path beside the PDF field', async () => {
    const error = await refusal(nativeName)
    expect([error.field, error.reason, error.character]).toEqual(['TextField20[1]', 'missing-glyph', '王'])
    expect(error.paths).toEqual(['fields.nameInNativeAlphabet'])
    expect(error.message).toContain('Cannot fill PDF field "TextField20[1]" with fields.nameInNativeAlphabet: no available font can draw "王" (U+738B)')
  })

  it('tells each reader what to do: a font on the PDF layer, or one from the SDK', async () => {
    const { message } = await refusal(nativeName)
    expect(message).toContain('on the PDF layer of the artifact: "font": { "path": "<file>.ttf" }')
    expect(message).toContain('pdfRenderer({ font })')
  })

  it('is drawn when the layer declares a font that has its characters', async () => {
    const cjk: PdfFont = { bytes: syntheticFont({ name: 'AsterdocTestNative', characters: '王小明' }), source: 'fonts/native.ttf' }
    expect(await drawnText({ ...nativeName, layerFont: cjk })).toBe('王小明')
  })

  it('names a party path as fill data writes it', async () => {
    const error = await refusal({
      template: acroFieldsPdf([box('family')]),
      data: { fields: {}, parties: { client: { lastName: 'Петров' } } },
      bindings: { family: 'parties.client.lastName' },
    })
    expect(error.paths).toEqual(['parties.client.lastName'])
    expect(error.message).toContain('"family" with parties.client.lastName:')
  })

  it('names every path a template binding reads', async () => {
    const error = await refusal({
      template: acroFieldsPdf([box('cityState')]),
      data: { fields: { city: 'Łódź', state: 'LD' }, parties: { client: { lastName: 'Kowalski' } } },
      bindings: { cityState: { template: '{{fields.city}}, {{fields.state}} ({{parties.client.lastName}})' } },
    })
    expect(error.character).toBe('Ł')
    expect(error.paths).toEqual(['fields.city', 'fields.state', 'parties.client.lastName'])
    expect(error.message).toContain('"cityState" with fields.city, fields.state, parties.client.lastName:')
  })

  it('names the field of a form that fills its PDF fields by id', async () => {
    const form = { kind: 'form', name: 'by-id', version: '1.0.0', title: 'By id', fields: { surname: { type: 'text', label: 'Surname' } } } as Form
    const error = await refusal({ template: acroFieldsPdf([box('surname')]), form, data: { fields: { surname: 'Жук' } } })
    expect([error.field, error.paths]).toEqual(['surname', ['fields.surname']])
  })
})

describe('a value in a script that needs shaping', () => {
  it('is refused with the artifact path and without advice to add a font', async () => {
    const error = await refusal({
      template: acroFieldsPdf([box('name')]),
      data: { fields: { nameInNativeAlphabet: 'محمد' } },
      bindings: { name: 'nameInNativeAlphabet' },
      layerFont: liberation,
    })
    expect([error.reason, error.script, error.paths]).toEqual(['unsupported-script', 'Arabic', ['fields.nameInNativeAlphabet']])
    expect(error.message).toContain('"name" with fields.nameInNativeAlphabet: the value contains Arabic script')
    expect(error.message).toContain('whatever the font')
    expect(error.message).not.toMatch(/Declare a font|pdfRenderer/)
  })
})

describe('a value that does not fit', () => {
  it('is refused with the artifact path of the bound field', async () => {
    const error = await refusal({
      template: acroFieldsPdf([box('memo', { rect: [100, 600, 130, 612] })]),
      data: { fields: { memo: 'A value far too long for a box of thirty points' } },
      bindings: { memo: 'memo' },
    })
    expect([error.reason, error.limit, error.paths]).toEqual(['overflow', 6, ['fields.memo']])
    expect(error.message).toContain('Cannot fill PDF field "memo" with fields.memo:')
  })

  it('keeps the reason and the limit when the paths are added', () => {
    const error = new PdfFieldFillError('ssn', 'comb-length', { limit: 3 }, 'too long')
    expect(error.message).toBe('Cannot fill PDF field "ssn": too long')
    const named = error.withPaths(['fields.ssn'])
    expect([named.field, named.reason, named.limit, named.paths]).toEqual(['ssn', 'comb-length', 3, ['fields.ssn']])
    expect(named.message).toBe('Cannot fill PDF field "ssn" with fields.ssn: too long')
  })
})

describe('a text overlay', () => {
  const page = pagePdf([[300, 300]])

  it('bound to a field names the artifact path it prints', async () => {
    const error = await refusal({ template: page, data: { fields: { surname: 'Жук' } }, overlays: [{ page: 1, x: 20, y: 20, field: 'surname' }] })
    expect([error.reason, error.paths]).toEqual(['missing-glyph', ['fields.surname']])
  })

  it('bound to a field names the path when its text does not fit', async () => {
    const error = await refusal({
      template: page,
      data: { fields: { surname: 'A surname far too long for ten points' } },
      overlays: [{ page: 1, x: 20, y: 20, width: 10, field: 'fields.surname' }],
    })
    expect([error.reason, error.paths]).toEqual(['overflow', ['fields.surname']])
  })

  it('with fixed text names no artifact path', async () => {
    const error = await refusal({ template: page, data: {}, overlays: [{ page: 1, x: 20, y: 20, text: 'Жук' }] })
    expect(error.paths).toBeUndefined()
    expect(error.message).toContain('Cannot fill PDF field "text overlay 1 (page 1)": no available font')
  })
})

describe('the PDF font check', () => {
  const form = {
    kind: 'form',
    name: 'font-check',
    version: '1.0.0',
    title: 'Font check',
    fields: {
      surname: { type: 'text', label: 'Surname' },
      given: { type: 'text', label: 'Given name' },
      memo: { type: 'text', label: 'Memo' },
    },
  } as Form
  const template = acroFieldsPdf([box('surname'), box('surnameAgain'), box('given'), box('memo', { rect: [100, 500, 130, 512] })])
  const cyrillic = syntheticFont({ name: 'AsterdocTestUpper', characters: 'ЖУК ' })

  const request = (
    fields: Record<string, unknown>,
    layer: Partial<RendererLayer> = {},
  ): RenderRequest<RendererLayer> => ({
    kind: 'form',
    artifact: form,
    data: { fields },
    template: {
      type: 'pdf',
      mimeType: 'application/pdf',
      content: template,
      bindings: { surname: 'surname', surnameAgain: 'fields.surname', given: 'given', memo: 'memo' },
      ...layer,
    },
  })

  it('returns the error a render throws for each field whose text no font can draw', async () => {
    const data = { surname: 'Жук', given: 'Łukasz', memo: 'ok' }
    const refused = await pdfFontCheck().render(request(data))
    expect(refused.map((error) => [error.field, error.paths, error.character])).toEqual([
      ['surname', ['fields.surname'], 'Ж'],
      ['surnameAgain', ['fields.surname'], 'Ж'],
      ['given', ['fields.given'], 'Ł'],
    ])
    const thrown = await refusal({ template, form, data: { fields: data }, bindings: request(data).template.bindings })
    expect(refused[0]!.message).toBe(thrown.message)
  })

  it('returns nothing for Latin-1 values', async () => {
    expect(await pdfFontCheck().render(request({ surname: 'Crème', given: 'Zoë', memo: 'ok' }))).toEqual([])
  })

  it('returns nothing when the layer font has the characters', async () => {
    const font = { content: liberationSans(), path: 'fonts/LiberationSans-Regular.ttf' }
    expect(await pdfFontCheck().render(request({ surname: 'Жук', given: 'Łukasz' }, { font }))).toEqual([])
  })

  it('checks the text as the layer format prints it', async () => {
    const font = { content: cyrillic, path: 'fonts/upper.ttf' }
    const check = pdfFontCheck()
    expect(await check.render(request({ surname: 'жук' }, { font, format: { case: 'upper' } }))).toEqual([])
    const lower = await check.render(request({ surname: 'жук' }, { font }))
    expect(lower.map((error) => [error.field, error.character])).toEqual([['surname', 'ж'], ['surnameAgain', 'ж']])
  })

  it('reports a script that needs shaping', async () => {
    const [error] = await pdfFontCheck().render(request({ given: 'שלום' }))
    expect([error!.field, error!.reason, error!.script, error!.paths]).toEqual(['given', 'unsupported-script', 'Hebrew', ['fields.given']])
  })

  it('does not report a value that fails for another reason', async () => {
    const memo = 'A value far too long for a box of thirty points'
    expect(await pdfFontCheck().render(request({ memo }))).toEqual([])
    await expect(renderPdf({ template, form, data: { fields: { memo } }, bindings: { memo: 'memo' } })).rejects.toMatchObject({ reason: 'overflow' })
  })

  it('takes many sets of data for one layer', async () => {
    const check = pdfFontCheck()
    const counts: number[] = []
    for (const surname of ['Жук', 'Smith', 'Ωμέγα']) counts.push((await check.render(request({ surname }))).length)
    expect(counts).toEqual([2, 0, 2])
  })

  it('refuses a layer that carries no PDF bytes', async () => {
    const text = { ...request({}), template: { type: 'text' as const, content: 'plain' } }
    await expect(pdfFontCheck().render(text)).rejects.toThrow('needs a PDF layer that carries its bytes')
  })
})
