import type { Form } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { pdfPrintFailures, readPdfPrintProfile, renderPdf, type PdfFont, type RenderPdfOptions } from '../src/pdf'
import { syntheticFont } from './font-fixtures'
import { acroFieldsPdf, type FixtureField } from './pdf-fixtures'

const COMB = 1 << 24
const form = { kind: 'form', name: 'print', fields: { name: { type: 'text' }, code: { type: 'text' } } } as unknown as Form
const boxes: FixtureField[] = [
  { name: 'name', rect: [20, 700, 140, 714], da: '/Helv 10 Tf 0 g' },
  { name: 'code', rect: [20, 650, 120, 664], flags: COMB, maxLen: 4 },
]
const template = acroFieldsPdf(boxes)
const cjk: PdfFont = { bytes: syntheticFont({ name: 'AsterdocTestCJK', characters: '王小明 ' }), source: 'cjk.ttf' }
type Fonts = Pick<RenderPdfOptions, 'layerFont' | 'standardFont' | 'bindings'>

async function both(fields: Record<string, unknown>, fonts: Fonts = {}) {
  const profile = await readPdfPrintProfile({ template, form, ...fonts })
  const failures = pdfPrintFailures(profile, { data: { fields } })
  const rendered = await renderPdf({ template, form, data: { fields }, ...fonts }).then(() => undefined, (error: Error) => error)
  return { failures, rendered }
}

describe('a print profile, read once when the form loads', () => {
  it.each([
    ['data that prints', { name: 'Ada 王小明', code: '1234' }, { layerFont: cjk }],
    ['data that prints in Helvetica', { name: 'Crème brûlée', code: '1234' }, {}],
    ['a value too long for its box', { name: 'An exceptionally long name that cannot fit this box at all' }, {}],
    ['a value in the layer\'s Courier', { name: 'Ada Lovelace Byron King' }, { standardFont: 'Courier' }],
    ['more characters than comb boxes', { code: '12345' }, {}],
    ['a character no font has', { name: '王' }, {}],
    ['a character a standard font does not have', { name: 'Łódź' }, {}],
    ['a script that needs shaping', { name: 'محمد' }, { layerFont: cjk }],
  ] as Array<[string, Record<string, unknown>, Fonts]>)('refuses exactly what a render refuses: %s', async (_case, fields, fonts) => {
    const { failures, rendered } = await both(fields, fonts)
    expect(failures.map((failure) => failure.error.message)).toEqual(rendered ? [rendered.message] : [])
  })

  it('names the field, the artifact path and the reason', async () => {
    const { failures } = await both({ code: '12345' })
    expect(failures).toEqual([expect.objectContaining({ field: 'code', paths: ['fields.code'], message: expect.stringContaining('4 comb boxes') })])
  })
})

describe('a print profile and the bindings of its layer', () => {
  const phoneForm = { kind: 'form', name: 'print', fields: { phone: { type: 'phone' }, name: { type: 'text' } } } as unknown as Form
  const withBox = acroFieldsPdf([...boxes, { name: 'agree', rect: [20, 600, 34, 614], type: 'Btn' }])

  it.each([
    ['a value it can read', { phone: { number: '+12125551234' } }, false],
    ['a value whose part it cannot read', { phone: { number: '+99912345' } }, true],
  ])('reads a value bound to a field it does not lay out, as a render does: %s', async (_case, fields, refused) => {
    const bindings = { agree: { path: 'phone', part: 'nationalNumber' } } as never
    const profile = await readPdfPrintProfile({ template: withBox, form: phoneForm, bindings })
    const failures = pdfPrintFailures(profile, { data: { fields } })
    const rendered = await renderPdf({ template: withBox, form: phoneForm, data: { fields }, bindings }).then(() => undefined, (error: Error) => error)
    expect(rendered !== undefined).toBe(refused)
    expect(failures.map((failure) => failure.error.message)).toEqual(rendered ? [rendered.message] : [])
  })

  it('loads a layer whose binding keys are all fields of its template', async () => {
    await expect(readPdfPrintProfile({ template, form, bindings: { name: 'name', code: 'code' } })).resolves.toBeDefined()
  })

  it('refuses at load a binding key that is not a field of the template, with the error a render throws', async () => {
    const bindings = { nmae: 'name' }
    const rendered = await renderPdf({ template, form, data: { fields: { name: 'Ada' } }, bindings }).then(() => undefined, (error: Error) => error)
    await expect(readPdfPrintProfile({ template, form, bindings })).rejects.toThrow(rendered?.message ?? 'a render error')
    expect(rendered?.name).toBe('PdfBindingKeyError')
  })
})

describe('a print profile and a dropdown', () => {
  const COMBO = 1 << 17
  const choiceForm = { kind: 'form', name: 'print', fields: { kind: { type: 'text' } } } as unknown as Form
  const dropdown = acroFieldsPdf([{
    name: 'kind',
    type: 'Ch',
    flags: COMBO,
    rect: [20, 700, 80, 714],
    da: '/Helv 10 Tf 0 g',
    options: [['P', 'Partnership'], ['L', 'A limited liability company taxed as a partnership under subchapter K']],
  }])

  it.each([
    ['an option whose display text fits', 'P', false],
    ['an option whose display text does not fit, though its export value does', 'L', true],
  ])('measures the display text a render draws: %s', async (_case, value, refused) => {
    const profile = await readPdfPrintProfile({ template: dropdown, form: choiceForm })
    const failures = pdfPrintFailures(profile, { data: { fields: { kind: value } } })
    const rendered = await renderPdf({ template: dropdown, form: choiceForm, data: { fields: { kind: value } } }).then(() => undefined, (error: Error) => error)
    expect(rendered !== undefined).toBe(refused)
    expect(failures.map((failure) => failure.error.message)).toEqual(rendered ? [rendered.message] : [])
  })
})
