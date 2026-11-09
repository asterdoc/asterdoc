import type { Bindings, Form, LayerFormat } from '@asterdoc/types'
import { createFormatter } from '@asterdoc/format'
import { zipSync, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { hasNewFormatOptions, mergeFormats, parseBinding, parseBindings, PdfBindingSyntaxError, resolveLayerBindings } from '../src/index'
import { checkPdfBindingFit, extractPdfData, renderPdf } from '../src/pdf'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { renderText, textRenderer, ArtifactFieldFormatError } from '../src/text'
import { docxRenderer, renderDocx } from '../src/docx'
import { acroFormPdf, type AcroFormFixtureField } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'value-formats',
  version: '1.0.0',
  fields: {
    dob: { type: 'date' },
    filed: { type: 'date' },
    amount: { type: 'money', currency: 'USD' },
    status: { type: 'enum', enum: [{ value: 'single', label: 'Single' }, { value: 'married', label: 'Married' }] },
    wed: { type: 'boolean' },
    ssn: { type: 'text', maxLength: 11 },
    home: { type: 'address' },
    people: { type: 'list', item: { type: 'fieldset', fields: { name: { type: 'text', maxLength: 40 }, born: { type: 'date' } } } },
  },
  parties: { client: { partyType: 'person' } },
} as unknown as Form

const data = {
  fields: {
    dob: '2021-06-15',
    filed: '2020-01-02',
    amount: { amount: 12000.5, currency: 'USD' },
    status: 'married',
    wed: true,
    ssn: '123-45-6789',
    home: { line1: '1 Main St', locality: 'Springfield', region: 'IL', postalCode: '62701', country: 'US' },
    people: [{ name: 'Ann', born: '1990-03-04' }, { name: 'Bo', born: '1992-07-08' }],
  },
  parties: { client: { name: 'Jane Public', firstName: 'Jane', lastName: 'Public' } },
}

const textBoxes = (...names: string[]): AcroFormFixtureField[] => names.map((name) => ({ kind: 'text', name }))

async function values(pdf: Uint8Array): Promise<Record<string, unknown>> {
  return Object.fromEntries((await inspectAcroFormFields(pdf, { includeButton: true })).map((field) => [field.name, field.value]))
}

describe('merging formats', () => {
  it('merges per kind and per property, lowest level first', () => {
    const layer: LayerFormat = { money: { currencyDisplay: 'none' }, date: { pattern: 'MM/DD/YYYY' } }
    expect(mergeFormats(layer, { date: { pattern: 'YYYY-MM-DD' } })).toEqual({ money: { currencyDisplay: 'none' }, date: { pattern: 'YYYY-MM-DD' } })
    expect(mergeFormats(layer, { money: {} })).toEqual(layer)
    expect(mergeFormats({ money: {} }, { money: { currencyDisplay: 'none' } })).toEqual({ money: { currencyDisplay: 'none' } })
  })

  it('lets a higher locale replace a lower one', () => {
    expect(mergeFormats({ locale: 'en-US', date: { pattern: 'MM/DD/YYYY' } }, { locale: 'de-DE' })).toEqual({ locale: 'de-DE', date: { pattern: 'MM/DD/YYYY' } })
  })

  it('skips absent levels and keeps undefined members from erasing lower ones', () => {
    expect(mergeFormats(undefined, undefined)).toBeUndefined()
    expect(mergeFormats(undefined, { locale: 'fr-FR' }, undefined)).toEqual({ locale: 'fr-FR' })
    expect(mergeFormats({ money: { currencyDisplay: 'none' } }, { money: { currencyDisplay: undefined } })).toEqual({ money: { currencyDisplay: 'none' } })
  })

  it('treats only money.currencyDisplay and date.pattern as the options of 0.11', () => {
    expect(hasNewFormatOptions(undefined)).toBe(false)
    expect(hasNewFormatOptions({ money: { currencyDisplay: 'none' }, date: { pattern: 'MM/DD/YYYY' } })).toBe(false)
    expect(hasNewFormatOptions({ money: {} })).toBe(false)
    expect(hasNewFormatOptions({ locale: 'en-US' })).toBe(true)
    expect(hasNewFormatOptions({ money: { useGrouping: false } } as unknown as LayerFormat)).toBe(true)
  })
})

describe('reading a binding value', () => {
  it('reads a binding object as its path would read, with its format', () => {
    const format: LayerFormat = { date: { pattern: 'YYYY-MM-DD' } }
    expect(parseBinding({ path: 'fields.dob', format })).toEqual({ path: 'fields.dob', parts: [{ source: 'fields.dob', path: 'dob' }], format })
    expect(parseBinding({ path: 'ssn:2' })).toEqual({ path: 'ssn:2', parts: [{ source: 'ssn', path: 'ssn', qualifier: '2' }] })
    expect(parseBinding('city, state')).toEqual(parseBinding({ path: 'city, state' }))
  })

  it('keeps the PDF field each binding fills', () => {
    expect(parseBindings({ a: 'dob', b: { path: 'filed' } }).map(({ field, path }) => [field, path])).toEqual([['a', 'dob'], ['b', 'filed']])
  })

  it('refuses a value of neither shape, and a format that is not an object', () => {
    expect(() => parseBinding(42 as unknown as string)).toThrow(PdfBindingSyntaxError)
    expect(() => parseBinding({ format: {} } as unknown as string)).toThrow('neither a path string nor a binding object')
    expect(() => parseBinding({ path: 'dob', format: 'MM/DD/YYYY' } as unknown as string)).toThrow('format that is not an object')
    expect(() => parseBinding({ path: 'city,,zip' })).toThrow('Binding "city,,zip" has an empty path.')
  })
})

describe('a PDF binding format', () => {
  const template = () => acroFormPdf(textBoxes('dob', 'filed', 'amount', 'plainAmount', 'both'))

  it('overrides the layer format for its own value only', async () => {
    const bindings: Bindings = { dob: { path: 'dob', format: { date: { pattern: 'YYYY-MM-DD' } } }, filed: 'filed' }
    const pdf = await renderPdf({ template: template(), form, data, bindings, format: { date: { pattern: 'MM/DD/YYYY' } } })
    expect(await values(pdf)).toMatchObject({ dob: '2021-06-15', filed: '01/02/2020' })
  })

  it('applies with no layer format, merged per property', async () => {
    const bindings: Bindings = { amount: { path: 'amount', format: { money: { currencyDisplay: 'none' } } }, plainAmount: 'amount' }
    expect(await values(await renderPdf({ template: template(), form, data, bindings }))).toMatchObject({ amount: '12,000.50', plainAmount: '$12,000.50' })
    const layered = await renderPdf({ template: template(), form, data, bindings: { amount: { path: 'amount', format: { money: {} } } }, format: { money: { currencyDisplay: 'none' } } })
    expect(await values(layered)).toMatchObject({ amount: '12,000.50' })
  })

  it('formats each value of a joined path before the join', async () => {
    const bindings: Bindings = { both: { path: 'dob, filed', format: { date: { pattern: 'DD/MM/YYYY' } } } }
    expect(await values(await renderPdf({ template: template(), form, data, bindings }))).toMatchObject({ both: '15/06/2021, 02/01/2020' })
  })

  it('prints names and words in its locale, over the layer locale', async () => {
    const bindings: Bindings = { dob: 'dob', filed: { path: 'filed', format: { locale: 'en-GB' } } }
    const pdf = await renderPdf({ template: template(), form, data, bindings, format: { locale: 'de-DE' }, formatter: createFormatter({ locale: 'en-US' }) })
    const printed = await values(pdf)
    expect(printed.dob).toBe(createFormatter({ locale: 'de-DE' }).formatDate('2021-06-15'))
    expect(printed.filed).toBe(createFormatter({ locale: 'en-GB' }).formatDate('2020-01-02'))
    expect(printed.dob).not.toBe(createFormatter({ locale: 'en-US' }).formatDate('2021-06-15'))
  })

  it('is refused on an option test, which fills a checkbox, and on a split part, which prints a piece of the raw value', async () => {
    const checks = acroFormPdf([{ kind: 'checkbox', name: 'married' }, { kind: 'checkbox', name: 'wed' }, { kind: 'text', name: 'ssn2' }])
    const format: LayerFormat = { date: { pattern: 'MM/DD/YYYY' } }
    await expect(renderPdf({ template: checks, form, data, bindings: { married: { path: 'status:married', format } } }))
      .rejects.toThrow('Binding "status:married" sets a format on the option test "status:married"')
    await expect(renderPdf({ template: checks, form, data, bindings: { wed: { path: 'wed:1', format } } })).rejects.toThrow(PdfBindingSyntaxError)
    await expect(renderPdf({ template: checks, form, data, bindings: { ssn2: { path: 'ssn:2', format } } }))
      .rejects.toThrow('Binding "ssn:2" sets a format on the split part "ssn:2"')
    const split = await renderPdf({ template: checks, form, data, bindings: { ssn2: { path: 'ssn:2' }, married: { path: 'status:married' } } })
    expect(await values(split)).toMatchObject({ ssn2: '45', married: true })
  })
})

describe('filling by field id', () => {
  const unused = { ...data, fields: { ...data.fields, filed: 'not-a-date' } }

  it('formats only the fields the PDF has a box for when the layer opts into per-value formatting', async () => {
    const pdf = await renderPdf({ template: acroFormPdf(textBoxes('dob')), form, data: unused, format: { locale: 'en-US' } })
    expect((await values(pdf)).dob).toBe(createFormatter({ locale: 'en-US' }).formatDate('2021-06-15'))
  })

  it('keeps failing on an invalid unused field when no new option applies, as before', async () => {
    await expect(renderPdf({ template: acroFormPdf(textBoxes('dob')), form, data: unused })).rejects.toThrow()
  })
})

describe('formatting values one by one', () => {
  const datetime = { ...data, fields: { ...data.fields, filed: '2020-01-02T10:00:00Z' } }
  const template = () => acroFormPdf(textBoxes('dob', 'filed'))
  const format: LayerFormat = { date: { pattern: 'MM/DD/YYYY' } }

  it('keeps the one pass over all data when no binding sets a format', async () => {
    await expect(renderPdf({ template: template(), form, data: datetime, bindings: { dob: 'dob' }, format })).rejects.toThrow(ArtifactFieldFormatError)
  })

  it('fails only for a value a binding reads once a binding sets a format', async () => {
    const pdf = await renderPdf({ template: template(), form, data: datetime, bindings: { dob: { path: 'dob', format: {} } }, format })
    expect(await values(pdf)).toMatchObject({ dob: '06/15/2021' })
    await expect(renderPdf({ template: template(), form, data: datetime, bindings: { dob: { path: 'dob', format: {} }, filed: 'filed' }, format }))
      .rejects.toThrow('Cannot format fields.filed')
  })

  it('fails only for a value a binding reads when the layer sets a locale', async () => {
    const pdf = await renderPdf({ template: template(), form, data: datetime, bindings: { dob: 'dob' }, format: { ...format, locale: 'en-US' } })
    expect(await values(pdf)).toMatchObject({ dob: '06/15/2021' })
  })

  it('fills every kind of path as the one pass does', async () => {
    const names = ['dob', 'amount', 'status', 'wedText', 'married', 'single', 'ssn1', 'ssn3', 'city', 'home', 'person0', 'born1', 'client', 'clientLast', 'joined']
    const fields: AcroFormFixtureField[] = names.map((name) => name === 'married' || name === 'single' ? { kind: 'checkbox', name } : { kind: 'text', name })
    const strings: Record<string, string> = {
      dob: 'fields.dob', amount: 'amount', status: 'status', wedText: 'wed', married: 'status:married', single: 'status:single',
      ssn1: 'ssn:1', ssn3: 'ssn:3', city: 'home.locality', home: 'home', person0: 'people[0].name', born1: 'people.1.born',
      client: 'parties.client', clientLast: 'parties.client.lastName', joined: 'home.locality, home.region',
    }
    const objects: Bindings = Object.fromEntries(Object.entries(strings).map(([key, path]) => [key, path.includes(':') ? { path } : { path, format: {} }]))
    for (const layerFormat of [undefined, { money: { currencyDisplay: 'none' }, date: { pattern: 'DD/MM/YYYY' } }] as const) {
      const once = await values(await renderPdf({ template: acroFormPdf(fields), form, data, bindings: strings, format: layerFormat }))
      const each = await values(await renderPdf({ template: acroFormPdf(fields), form, data, bindings: objects, format: layerFormat }))
      expect(each).toEqual(once)
      expect(once).toMatchObject({ married: true, single: false, ssn3: '6789', person0: 'Ann', clientLast: 'Public', joined: 'Springfield, IL' })
    }
  })

  it('fills by field id and draws overlays as the one pass does', async () => {
    const plain = { kind: 'form', name: 'ids', version: '1.0.0', fields: { dob: { type: 'date' }, amount: { type: 'money' } } } as unknown as Form
    const fields = textBoxes('dob', 'amount')
    const overlays = [{ page: 1, x: 10, y: 10, field: 'fields.dob' }]
    const own = { fields: { dob: data.fields.dob, amount: data.fields.amount } }
    const once = await renderPdf({ template: acroFormPdf(fields), form: plain, data: own, overlays, format: { date: { pattern: 'MM/DD/YYYY' } } })
    const each = await renderPdf({ template: acroFormPdf(fields), form: plain, data: own, overlays, format: { date: { pattern: 'MM/DD/YYYY' }, locale: 'en-US' } })
    expect(await values(each)).toEqual(await values(once))
    expect(await values(each)).toMatchObject({ dob: '06/15/2021', amount: '$12,000.50' })
    expect(new TextDecoder('latin1').decode(each)).toContain('(06/15/2021) Tj')
  })
})

describe('reused bindings', () => {
  const pdf = 'application/pdf'
  const layers = {
    copyA: { mimeType: pdf, format: { date: { pattern: 'MM/DD/YYYY' } } as LayerFormat, bindings: { dob: { path: 'dob', format: { date: { pattern: 'YYYY-MM-DD' } } }, filed: 'filed' } as Bindings },
    copyB: { mimeType: pdf, bindingsFrom: 'copyA' },
  }

  it('carry each binding format to the reusing layer, but not the source layer format', async () => {
    const bindings = resolveLayerBindings(layers, layers.copyB)
    expect(bindings).toEqual(layers.copyA.bindings)
    const printed = await values(await renderPdf({ template: acroFormPdf(textBoxes('dob', 'filed')), form, data, bindings }))
    expect(printed).toEqual({ dob: '2021-06-15', filed: 'Jan 2, 2020' })
  })
})

describe('a text layer format', () => {
  const template = 'Born {{fields.dob}}, owes {{fields.amount}}'

  it('applies to the values the template prints', () => {
    expect(renderText({ template, form, data })).toBe('Born Jun 15, 2021, owes $12,000.50')
    expect(renderText({ template, form, data, format: { date: { pattern: 'MM/DD/YYYY' }, money: { currencyDisplay: 'none' } } })).toBe('Born 06/15/2021, owes 12,000.50')
    expect(renderText({ template, form, data, format: { locale: 'de-DE' } })).toBe(`Born ${createFormatter({ locale: 'de-DE' }).formatDate('2021-06-15')}, owes ${createFormatter({ locale: 'de-DE' }).formatMoney({ amount: 12000.5, currency: 'USD' })}`)
  })

  it('reaches the text renderer from the layer', async () => {
    const output = await textRenderer().render({
      kind: 'form',
      artifact: form,
      data,
      template: { type: 'text', mimeType: 'text/markdown', content: template, format: { date: { pattern: 'YYYY-MM-DD' } } },
    } as never)
    expect(output).toBe('Born 2021-06-15, owes $12,000.50')
  })
})

describe('a DOCX layer format', () => {
  const encoder = new TextEncoder()
  const docx = (text: string) => zipSync({
    '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': encoder.encode(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`),
  })
  const visible = (bytes: Uint8Array) => [...new TextDecoder().decode(unzipSync(bytes)['word/document.xml']).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join('')
  const template = 'Born {{fields.dob}}, owes {{fields.amount}}'

  it('applies to the values the document prints', async () => {
    expect(visible(await renderDocx({ template: docx(template), form, data }))).toBe('Born Jun 15, 2021, owes $12,000.50')
    expect(visible(await renderDocx({ template: docx(template), form, data, format: { date: { pattern: 'DD/MM/YYYY' }, money: { currencyDisplay: 'none' } } }))).toBe('Born 15/06/2021, owes 12,000.50')
  })

  it('reaches the DOCX renderer from the layer', async () => {
    const output = await docxRenderer().render({
      kind: 'form',
      artifact: form,
      data,
      template: { type: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: docx(template), format: { date: { pattern: 'MM/DD/YYYY' } } },
    } as never)
    expect(visible(output)).toBe('Born 06/15/2021, owes $12,000.50')
  })
})

describe('the fit check', () => {
  it('reads a binding object as its path', async () => {
    const tight = { kind: 'form', name: 'fit', version: '1.0.0', fields: { name: { type: 'text', maxLength: 400 } } } as unknown as Form
    const template = acroFormPdf(textBoxes('box'))
    const fromString = await checkPdfBindingFit({ template, form: tight, bindings: { box: 'name' } })
    const fromObject = await checkPdfBindingFit({ template, form: tight, bindings: { box: { path: 'name', format: { locale: 'en-US' } } } })
    expect(fromString.length).toBeGreaterThan(0)
    expect(fromObject).toEqual(fromString)
    expect(fromObject[0]).toMatchObject({ binding: 'name', paths: ['fields.name'] })
  })
})

describe('reading a filled PDF back', () => {
  const template = () => acroFormPdf(textBoxes('dob', 'filed'))

  it('reads each value by its own binding format and flags every recovered value lossless', async () => {
    const bindings: Bindings = { dob: { path: 'dob', format: { date: { pattern: 'DD/MM/YYYY' } } }, filed: 'filed' }
    const format: LayerFormat = { date: { pattern: 'MM/DD/YYYY' } }
    const pdf = await renderPdf({ template: template(), form, data, bindings, format })
    expect(await values(pdf)).toEqual({ dob: '15/06/2021', filed: '01/02/2020' })
    const result = await extractPdfData({ pdf, form, bindings, format })
    expect(result.data.fields).toEqual({ dob: '2021-06-15', filed: '2020-01-02' })
    expect(result.report.entries.map(({ path, status, lossy }) => ({ path, status, lossy }))).toEqual([
      { path: 'dob', status: 'recovered', lossy: false },
      { path: 'filed', status: 'recovered', lossy: false },
    ])
  })

  it('sets no lossy flag on an entry it did not recover', async () => {
    const result = await extractPdfData({ pdf: acroFormPdf([{ kind: 'text', name: 'dob', value: 'not a date' }, { kind: 'text', name: 'filed' }]), form, bindings: { dob: 'dob', filed: 'filed' } })
    expect(result.report.entries.every((entry) => !('lossy' in entry))).toBe(true)
  })

  it('refuses a format on an option test or a split part', async () => {
    const pdf = acroFormPdf([{ kind: 'checkbox', name: 'married', checked: true }])
    await expect(extractPdfData({ pdf, form, bindings: { married: { path: 'status:married', format: { locale: 'en-US' } } } })).rejects.toThrow(PdfBindingSyntaxError)
    const parts = acroFormPdf(textBoxes('y', 'm', 'd'))
    const format: LayerFormat = { date: { pattern: 'MM/DD/YYYY' } }
    await expect(extractPdfData({ pdf: parts, form, bindings: { y: { path: 'dob:1', format }, m: 'dob:2', d: 'dob:3' } }))
      .rejects.toThrow('sets a format on the split part "dob:1"')
    const read = await extractPdfData({ pdf, form, bindings: { married: { path: 'status:married' } } })
    expect(read.data.fields).toEqual({ status: 'married' })
  })
})
