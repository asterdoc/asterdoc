import type { Bindings, Form, LayerFormat } from '@asterdoc/types'
import { createFormatter } from '@asterdoc/format'
import { phoneProvider } from '@asterdoc/format/phone'
import { createTypeEnv, T } from '@asterdoc/expr'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { PdfBindingSyntaxError } from '../src/index'
import { checkPdfBindingFit, extractPdfData, renderPdf } from '../src/pdf'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { ArtifactFieldFormatError, checkTextTemplate, formValueResolver, renderText, TemplateError } from '../src/text'
import { checkDocxTemplate, renderDocx } from '../src/docx'
import { acroFieldsPdf, acroFormPdf, type AcroFormFixtureField, type FixtureField } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'value-parts',
  version: '1.0.0',
  fields: {
    dob: { type: 'date' },
    home: { type: 'phone' },
    uk: { type: 'phone' },
    fee: { type: 'money', currency: 'USD', max: 99999 },
    small: { type: 'money', currency: 'USD' },
    big: { type: 'money', currency: 'USD' },
    loose: { type: 'money' },
    refund: { type: 'money' },
    yen: { type: 'money' },
    note: { type: 'text', maxLength: 20 },
    married: { type: 'boolean' },
    lines: { type: 'list', item: { type: 'fieldset', fields: { on: { type: 'date' } } } },
  },
  defs: { due: { type: 'date', value: 'fields.dob' } },
} as unknown as Form

const data = {
  fields: {
    dob: '2021-06-05',
    home: { number: '+12125551234', extension: '42' },
    uk: { number: '+442079460958' },
    fee: { amount: 1.999, currency: 'USD' },
    small: { amount: 0.05, currency: 'USD' },
    big: { amount: 1234.5, currency: 'USD' },
    loose: { amount: 7.25, currency: 'USD' },
    refund: { amount: -3.5, currency: 'USD' },
    yen: { amount: 500, currency: 'JPY' },
    note: 'hello',
    married: true,
    lines: [{ on: '2024-12-31' }],
  },
}

const textBoxes = (...names: string[]): AcroFormFixtureField[] => names.map((name) => ({ kind: 'text', name }))

async function values(pdf: Uint8Array): Promise<Record<string, unknown>> {
  return Object.fromEntries((await inspectAcroFormFields(pdf, { includeButton: true })).map((field) => [field.name, field.value]))
}

async function fill(bindings: Bindings, format?: LayerFormat, filled: Record<string, unknown> = data) {
  return values(await renderPdf({ template: acroFormPdf(textBoxes(...Object.keys(bindings))), form, data: filled, bindings, ...(format && { format }) }))
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => undefined, (caught: unknown) => caught)
}

async function formatError(run: () => Promise<unknown>): Promise<ArtifactFieldFormatError> {
  const error = await failure(run)
  expect(error).toBeInstanceOf(ArtifactFieldFormatError)
  return error as ArtifactFieldFormatError
}

describe('parts of a value bound to a PDF', () => {
  it('print a date\'s year, month and day as digits, unaffected by the date pattern', async () => {
    const bindings: Bindings = { y: { path: 'dob', part: 'year' }, m: { path: 'dob', part: 'month' }, d: { path: 'fields.dob', part: 'day' }, whole: 'dob' }
    expect(await fill(bindings, { date: { pattern: 'MM/DD/YYYY' } })).toEqual({ y: '2021', m: '06', d: '05', whole: '06/05/2021' })
  })

  it('print the pieces of a +1 phone number and its extension', async () => {
    const bindings: Bindings = {
      cc: { path: 'home', part: 'countryCode' },
      nn: { path: 'home', part: 'nationalNumber' },
      area: { path: 'home', part: 'areaCode' },
      sub: { path: 'home', part: 'subscriberNumber' },
      ext: { path: 'home', part: 'extension' },
    }
    expect(await fill(bindings, { phone: { style: 'national' } })).toEqual({ cc: '1', nn: '2125551234', area: '212', sub: '5551234', ext: '42' })
  })

  it('print the calling code and national number of a number outside +1, and nothing for an absent extension', async () => {
    const bindings: Bindings = { cc: { path: 'uk', part: 'countryCode' }, nn: { path: 'uk', part: 'nationalNumber' }, ext: { path: 'uk', part: 'extension' } }
    expect(await fill(bindings)).toEqual({ cc: '44', nn: '2079460958', ext: undefined })
  })

  it('refuse areaCode and subscriberNumber on a number outside +1 with unsupported_part', async () => {
    for (const part of ['areaCode', 'subscriberNumber'] as const) {
      const error = await formatError(() => fill({ area: { path: 'uk', part } }))
      expect(error.issues[0]).toMatchObject({ code: 'unsupported_part', path: 'fields.uk' })
      expect(error.message).toContain('+44')
    }
  })

  it('round money half-expand to two decimals, then split it into units and cents with no grouping', async () => {
    const bindings: Bindings = {
      feeUnits: { path: 'fee', part: 'units' }, feeCents: { path: 'fee', part: 'cents' },
      smallUnits: { path: 'small', part: 'units' }, smallCents: { path: 'small', part: 'cents' },
      bigUnits: { path: 'big', part: 'units' }, bigCents: { path: 'big', part: 'cents' },
      bigWhole: 'big',
    }
    expect(await fill(bindings, { money: { currencyDisplay: 'none' } })).toEqual({
      feeUnits: '2', feeCents: '00', smallUnits: '0', smallCents: '05', bigUnits: '1234', bigCents: '50', bigWhole: '1,234.50',
    })
  })

  it('round money exactly as whole money prints it, at the half-cent boundary', async () => {
    const half = { fields: { ...data.fields, small: { amount: 1.005, currency: 'USD' } } }
    const printed = await fill({ u: { path: 'small', part: 'units' }, c: { path: 'small', part: 'cents' }, whole: 'small' }, { money: { currencyDisplay: 'none' } }, half)
    expect(`${printed.u}.${printed.c}`).toBe(printed.whole)
    expect(printed).toEqual({ u: '1', c: '01', whole: '1.01' })
  })

  it('ignore the digit and grouping options whole money prints with', async () => {
    const formatter = createFormatter({ providers: { phone: phoneProvider }, money: { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: true } })
    const bindings: Bindings = { u: { path: 'big', part: 'units' }, c: { path: 'big', part: 'cents' }, whole: 'big' }
    const template = acroFormPdf(textBoxes('u', 'c', 'whole'))
    const printed = await values(await renderPdf({ template, form, data, bindings, formatter, format: { money: { currencyDisplay: 'none' } } }))
    expect(printed).toEqual({ u: '1234', c: '50', whole: '1,235' })
    const ungrouped = createFormatter({ providers: { phone: phoneProvider }, money: { useGrouping: false } })
    expect(await values(await renderPdf({ template, form, data, bindings, formatter: ungrouped, format: { money: { currencyDisplay: 'none' } } })))
      .toEqual({ u: '1234', c: '50', whole: '1234.50' })
  })

  it('refuse a phone part of a number outside the plan phone.region names, but not its extension', async () => {
    const berlin = { fields: { ...data.fields, home: { number: '+4930123456789', extension: '7' } } }
    for (const part of ['nationalNumber', 'countryCode'] as const) {
      const error = await formatError(() => fill({ nn: { path: 'home', part } }, { phone: { region: 'US' } }, berlin))
      expect(error.issues[0]).toMatchObject({ code: 'phone_region_mismatch', path: 'fields.home' })
      expect(error.message).toContain('+49')
    }
    const binding: Bindings = { nn: { path: 'home', part: 'nationalNumber', format: { phone: { region: 'US' } } } }
    expect((await formatError(() => fill(binding, undefined, berlin))).issues[0]).toMatchObject({ code: 'phone_region_mismatch' })
    expect(await fill({ nn: { path: 'home', part: 'nationalNumber' } }, undefined, berlin)).toEqual({ nn: '30123456789' })
    expect(await fill({ nn: { path: 'home', part: 'nationalNumber' } }, { phone: { region: 'US' } })).toEqual({ nn: '2125551234' })
    expect(await fill({ ext: { path: 'home', part: 'extension' } }, { phone: { region: 'US' } }, berlin)).toEqual({ ext: '7' })
  })

  it('refuse money parts of a negative amount or a currency without two minor digits with unsupported_part', async () => {
    const negative = await formatError(() => fill({ units: { path: 'refund', part: 'units' } }))
    expect(negative.issues[0]).toMatchObject({ code: 'unsupported_part', path: 'fields.refund' })
    expect(negative.message).toContain('-3.5')
    const yen = await formatError(() => fill({ cents: { path: 'yen', part: 'cents' } }))
    expect(yen.issues[0]).toMatchObject({ code: 'unsupported_part', path: 'fields.yen' })
    expect(yen.message).toContain('JPY has 0')
    expect(await fill({ cents: { path: 'yen', part: 'cents' } }, undefined, { fields: { ...data.fields, yen: { amount: 5, currency: 'EUR' } } })).toEqual({ cents: '00' })
  })

  it('fail only for a value a binding reads', async () => {
    expect(await fill({ y: { path: 'dob', part: 'year' }, units: { path: 'fee', part: 'units' } })).toEqual({ y: '2021', units: '2' })
  })

  it('print the other bindings of the layer as before', async () => {
    const plain: Bindings = { dob: 'dob', fee: 'fee', home: 'home', married: 'married' }
    const before = await fill(plain)
    expect(await fill({ ...plain, year: { path: 'dob', part: 'year' } })).toEqual({ ...before, year: '2021' })
  })

  it('read a list item\'s member', async () => {
    expect(await fill({ y: { path: 'lines[0].on', part: 'year' }, d: { path: 'lines.0.on', part: 'day' } })).toEqual({ y: '2024', d: '31' })
  })

  it('print nothing for a missing value', async () => {
    expect(await fill({ y: { path: 'dob', part: 'year' } }, undefined, { fields: {} })).toEqual({ y: undefined })
  })

  it('refuse an invalid date or phone value', async () => {
    const date = await formatError(() => fill({ y: { path: 'dob', part: 'year' } }, undefined, { fields: { dob: '2021-02-30' } }))
    expect(date.path).toBe('fields.dob')
    const phone = await formatError(() => fill({ nn: { path: 'home', part: 'nationalNumber' } }, undefined, { fields: { home: { number: '+15555555555' } } }))
    expect(phone.issues[0]).toMatchObject({ code: 'invalid_phone' })
  })

  it('need the phone provider for every phone part but the extension', async () => {
    const template = acroFormPdf(textBoxes('nn', 'ext'))
    const formatter = createFormatter()
    const error = await formatError(() => renderPdf({ template, form, data, formatter, bindings: { nn: { path: 'home', part: 'nationalNumber' } } }))
    expect(error.issues[0]).toMatchObject({ code: 'missing_format_provider' })
    expect(error.message).toContain('@asterdoc/format/phone')
    expect(await values(await renderPdf({ template, form, data, formatter, bindings: { ext: { path: 'home', part: 'extension' } } }))).toMatchObject({ ext: '42' })
  })

  it('refuse a part with a qualifier, on a joined path, or that the value\'s kind does not have', async () => {
    const cases: Array<[Bindings[string], RegExp]> = [
      [{ path: 'dob:1', part: 'year' }, /sets a part on the split part "dob:1"/],
      [{ path: 'married:yes', part: 'year' }, /sets a part on the option test "married:yes"/],
      [{ path: 'dob, fee', part: 'year' }, /prints the part "year" of a joined binding/],
      [{ path: 'note', part: 'year' }, /prints the part "year" of fields\.note, a text value; only date, phone and money values have parts/],
      [{ path: 'dob', part: 'units' }, /prints the part "units" of fields\.dob, a date value, whose parts are "year", "month", "day"/],
      [{ path: 'fee', part: 'areaCode' }, /whose parts are "units", "cents"/],
      [{ path: 'dob', part: 'week' } as never, /has the part "week", which is none of/],
    ]
    for (const [binding, message] of cases) {
      const error = await failure(() => fill({ box: binding }))
      expect(error, JSON.stringify(binding)).toBeInstanceOf(PdfBindingSyntaxError)
      expect((error as Error).message).toMatch(message)
    }
  })

  it('refuse a part without the artifact\'s declarations', async () => {
    const error = await failure(() => renderPdf({ template: acroFormPdf(textBoxes('y')), data, bindings: { y: { path: 'dob', part: 'year' } } }))
    expect(error).toBeInstanceOf(PdfBindingSyntaxError)
  })

  it('read a computed date by its declared type', async () => {
    expect(await fill({ y: { path: 'defs.due', part: 'year' } }, undefined, { ...data, defs: { due: '2030-01-02' } })).toEqual({ y: '2030' })
  })
})

describe('the fit check of parts', () => {
  const COMB = 1 << 24
  const box = (name: string, maxLen: number): FixtureField => ({ name, rect: [20, 20, 320, 34], flags: COMB, maxLen })
  const check = (fields: FixtureField[], bindings: Bindings, format?: LayerFormat) =>
    checkPdfBindingFit({ template: acroFieldsPdf(fields), form, bindings, ...(format && { format }) })

  it('checks each part at the digits it holds against a comb', async () => {
    expect(await check([box('y', 4), box('m', 2), box('d', 2)], { y: { path: 'dob', part: 'year' }, m: { path: 'dob', part: 'month' }, d: { path: 'dob', part: 'day' } })).toEqual([])
    const short = await check([box('y', 2)], { y: { path: 'dob', part: 'year' } })
    expect(short).toEqual([expect.objectContaining({ field: 'y', severity: 'error', reason: 'comb-length', limit: 2, length: 4 })])
    expect(short[0]!.message).toContain('part year')
    expect(await check([box('a', 3), box('s', 7), box('c', 2)], { a: { path: 'home', part: 'areaCode' }, s: { path: 'home', part: 'subscriberNumber' }, c: { path: 'fee', part: 'cents' } })).toEqual([])
    expect(await check([box('s', 6)], { s: { path: 'home', part: 'subscriberNumber' } })).toEqual([expect.objectContaining({ reason: 'comb-length', length: 7 })])
  })

  it('checks a national number at the longest number of phone.region\'s plan, or of any plan', async () => {
    const bindings: Bindings = { nn: { path: 'home', part: 'nationalNumber' } }
    expect(await check([box('nn', 10)], bindings, { phone: { region: 'US' } })).toEqual([])
    expect(await check([box('nn', 10)], bindings)).toEqual([expect.objectContaining({ reason: 'comb-length', length: 14 })])
  })

  it('passes a national number comb that render then fills, since render enforces phone.region', async () => {
    const template = acroFieldsPdf([box('nn', 10)])
    const format: LayerFormat = { phone: { region: 'US' } }
    const bindings: Bindings = { nn: { path: 'home', part: 'nationalNumber' } }
    expect(await checkPdfBindingFit({ template, form, bindings, format })).toEqual([])
    const berlin = { fields: { home: { number: '+4930123456789' } } }
    const error = await failure(() => renderPdf({ template, form, data: berlin, bindings, format }))
    expect(error).toBeInstanceOf(ArtifactFieldFormatError)
    expect((error as ArtifactFieldFormatError).issues[0]).toMatchObject({ code: 'phone_region_mismatch' })
    const filled = await values(await renderPdf({ template, form, data, bindings, format }))
    expect(filled).toEqual({ nn: '2125551234' })
  })

  it('checks a country code at the calling code of phone.region\'s plan, or three digits', async () => {
    const bindings: Bindings = { cc: { path: 'home', part: 'countryCode' } }
    expect(await check([box('cc', 1)], bindings, { phone: { region: 'US' } })).toEqual([])
    expect(await check([box('cc', 1)], bindings)).toEqual([expect.objectContaining({ reason: 'comb-length', length: 3 })])
  })

  it('bounds money units by the field\'s max as parts round it, across a carry', async () => {
    const priced = (max: number) => ({ ...form, fields: { ...form.fields, fee: { type: 'money', currency: 'USD', max } } }) as unknown as Form
    const bindings: Bindings = { u: { path: 'fee', part: 'units' } }
    const fit = (max: number, maxLen: number) => checkPdfBindingFit({ template: acroFieldsPdf([box('u', maxLen)]), form: priced(max), bindings })
    expect(await fit(999.99, 3)).toEqual([])
    const units = (await fill(bindings, undefined, { fields: { fee: { amount: 999.995, currency: 'USD' } } })).u as string
    const rounded = await fit(999.995, units.length - 1)
    expect(rounded).toEqual([expect.objectContaining({ reason: 'comb-length', length: units.length })])
    expect(await fit(999.995, units.length)).toEqual([])
  })

  it('bounds money units by the field\'s max, and warns when nothing bounds them', async () => {
    expect(await check([box('u', 5)], { u: { path: 'fee', part: 'units' } })).toEqual([])
    expect(await check([box('u', 4)], { u: { path: 'fee', part: 'units' } })).toEqual([expect.objectContaining({ reason: 'comb-length', length: 5 })])
    const loose = await check([box('u', 4)], { u: { path: 'loose', part: 'units' } })
    expect(loose).toEqual([expect.objectContaining({ severity: 'warning', reason: 'unbounded' })])
    expect(loose[0]!.message).toContain('has no max that bounds its length')
  })

  it('measures the widest digit, so a part that fits by count can still overflow a narrow box', async () => {
    const narrow: FixtureField = { name: 'y', rect: [20, 20, 26, 34] }
    expect(await check([narrow], { y: { path: 'dob', part: 'year' } })).toEqual([expect.objectContaining({ reason: 'overflow' })])
  })
})

describe('reading parts back', () => {
  async function readBack(bindings: Bindings, filled: Record<string, unknown> = data) {
    const pdf = await renderPdf({ template: acroFormPdf(textBoxes(...Object.keys(bindings))), form, data: filled, bindings })
    return extractPdfData({ pdf, form, bindings })
  }
  const entry = (result: Awaited<ReturnType<typeof readBack>>, path: string) => result.report.entries.find((item) => item.path === path)

  it('joins a date back from its year, month and day', async () => {
    const result = await readBack({ y: { path: 'dob', part: 'year' }, m: { path: 'dob', part: 'month' }, d: { path: 'dob', part: 'day' } })
    expect(result.data.fields).toEqual({ dob: '2021-06-05' })
    expect(entry(result, 'dob')).toMatchObject({ status: 'recovered', lossy: false, sources: [{ field: 'y', value: '2021' }, { field: 'm', value: '06' }, { field: 'd', value: '05' }] })
  })

  it('reports a date not recoverable when one of its parts is not bound', async () => {
    const result = await readBack({ y: { path: 'dob', part: 'year' }, m: { path: 'dob', part: 'month' } })
    expect(result.data.fields).toEqual({})
    expect(entry(result, 'dob')).toMatchObject({ status: 'not_recoverable', reason: expect.stringContaining('day is not bound') })
  })

  it('joins money back from units and cents in the field\'s currency', async () => {
    const result = await readBack({ u: { path: 'fee', part: 'units' }, c: { path: 'fee', part: 'cents' }, su: { path: 'small', part: 'units' }, sc: { path: 'small', part: 'cents' } })
    expect(result.data.fields).toEqual({ fee: { amount: 2, currency: 'USD' }, small: { amount: 0.05, currency: 'USD' } })
  })

  it('reports money not recoverable without both parts, or without a declared currency', async () => {
    expect(entry(await readBack({ u: { path: 'fee', part: 'units' } }), 'fee')).toMatchObject({ status: 'not_recoverable', reason: expect.stringContaining('cents is not bound') })
    expect(entry(await readBack({ u: { path: 'loose', part: 'units' }, c: { path: 'loose', part: 'cents' } }), 'loose'))
      .toMatchObject({ status: 'not_recoverable', reason: expect.stringContaining('currency') })
  })

  it('joins a phone back from its calling code and national number, with the extension only when it is bound', async () => {
    const parts: Bindings = { cc: { path: 'home', part: 'countryCode' }, nn: { path: 'home', part: 'nationalNumber' } }
    expect((await readBack({ ...parts, ext: { path: 'home', part: 'extension' } })).data.fields).toEqual({ home: { number: '+12125551234', extension: '42' } })
    expect((await readBack(parts)).data.fields).toEqual({ home: { number: '+12125551234' } })
    const uk = await readBack({ cc: { path: 'uk', part: 'countryCode' }, nn: { path: 'uk', part: 'nationalNumber' } })
    expect(uk.data.fields).toEqual({ uk: { number: '+442079460958' } })
  })

  it('joins a +1 number back from its area code and subscriber number', async () => {
    const result = await readBack({ a: { path: 'home', part: 'areaCode' }, s: { path: 'home', part: 'subscriberNumber' } })
    expect(result.data.fields).toEqual({ home: { number: '+12125551234' } })
  })

  it('reports a phone not recoverable without its calling code or national number', async () => {
    expect(entry(await readBack({ nn: { path: 'home', part: 'nationalNumber' } }), 'home')).toMatchObject({ status: 'not_recoverable', reason: expect.stringContaining('countryCode') })
    expect(entry(await readBack({ cc: { path: 'home', part: 'countryCode' }, ext: { path: 'home', part: 'extension' } }), 'home')).toMatchObject({ status: 'not_recoverable' })
    expect(entry(await readBack({ a: { path: 'home', part: 'areaCode' } }), 'home')).toMatchObject({ status: 'not_recoverable' })
  })

  describe('refuses phone parts that disagree with the number they join into', () => {
    const read = async (boxes: Record<string, string>, parts: Record<string, string>) => {
      const pdf = acroFormPdf(Object.entries(boxes).map(([name, value]) => ({ kind: 'text', name, value })))
      const bindings = Object.fromEntries(Object.entries(parts).map(([box, part]) => [box, { path: 'home', part }])) as Bindings
      const result = await extractPdfData({ pdf, form, bindings })
      return { result, entry: result.report.entries.find((item) => item.path === 'home') }
    }
    const nanp = { cc: '1', nn: '2125551234' }
    const nanpParts = { cc: 'countryCode', nn: 'nationalNumber' }

    it('accepts redundant parts that agree', async () => {
      const { result } = await read({ ...nanp, a: '212', s: '5551234' }, { ...nanpParts, a: 'areaCode', s: 'subscriberNumber' })
      expect(result.data.fields).toEqual({ home: { number: '+12125551234' } })
    })

    it('refuses each single conflicting part', async () => {
      const cases: Array<[Record<string, string>, Record<string, string>, string]> = [
        [{ ...nanp, a: '646' }, { ...nanpParts, a: 'areaCode' }, 'areaCode is not'],
        [{ ...nanp, s: '5550000' }, { ...nanpParts, s: 'subscriberNumber' }, 'subscriberNumber is not'],
        [{ cc: '44', a: '212', s: '5551234' }, { cc: 'countryCode', a: 'areaCode', s: 'subscriberNumber' }, ''],
        [{ nn: '6465551234', a: '212', s: '5551234' }, { nn: 'nationalNumber', a: 'areaCode', s: 'subscriberNumber' }, 'areaCode is not'],
        [{ cc: '1', nn: '6465551234', a: '212', s: '5551234' }, { cc: 'countryCode', nn: 'nationalNumber', a: 'areaCode', s: 'subscriberNumber' }, 'areaCode is not'],
      ]
      for (const [boxes, parts, reason] of cases) {
        const { result, entry } = await read(boxes, parts)
        expect(entry, JSON.stringify(boxes)).toMatchObject({ status: 'unparseable', reason: expect.stringContaining(reason) })
        expect(result.data.fields).toEqual({})
      }
    })

    it('refuses both conflicting parts at once', async () => {
      const { entry } = await read({ ...nanp, a: '646', s: '5550000' }, { ...nanpParts, a: 'areaCode', s: 'subscriberNumber' })
      expect(entry).toMatchObject({ status: 'unparseable', reason: expect.stringContaining('areaCode and subscriberNumber are not') })
    })

    it('refuses an area code or subscriber number beside a number outside +1, and ignores an empty one', async () => {
      for (const [box, part] of [['a', 'areaCode'], ['s', 'subscriberNumber']] as const) {
        const { entry } = await read({ cc: '44', nn: '2079460958', [box]: '207' }, { cc: 'countryCode', nn: 'nationalNumber', [box]: part })
        expect(entry).toMatchObject({ status: 'unparseable', reason: expect.stringContaining('exist only for +1 numbers') })
      }
      const { result } = await read({ cc: '44', nn: '2079460958', a: '' }, { cc: 'countryCode', nn: 'nationalNumber', a: 'areaCode' })
      expect(result.data.fields).toEqual({ home: { number: '+442079460958' } })
    })
  })

  it('reports parts empty when none holds text, and unparseable when they do not join', async () => {
    expect(entry(await readBack({ y: { path: 'dob', part: 'year' }, m: { path: 'dob', part: 'month' }, d: { path: 'dob', part: 'day' } }, { fields: {} }), 'dob')).toMatchObject({ status: 'empty' })
    const pdf = await renderPdf({
      template: acroFormPdf(textBoxes('y', 'm', 'd')), form, data: { fields: { dob: '2021-06-05' } },
      bindings: { y: 'dob', m: { path: 'dob', part: 'month' }, d: { path: 'dob', part: 'day' } },
    })
    const result = await extractPdfData({ pdf, form, bindings: { y: { path: 'dob', part: 'year' }, m: { path: 'dob', part: 'month' }, d: { path: 'dob', part: 'day' } } })
    expect(entry(result, 'dob')).toMatchObject({ status: 'unparseable' })
  })
})

const env = createTypeEnv({
  fields: T.object,
  'fields.dob': T.date,
  'fields.home': T.object,
  'fields.fee': T.object,
  'fields.note': T.string,
  'fields.lines': T.array(T.object),
  'fields.lines.on': T.date,
  due: T.date,
})
const resolver = formValueResolver(form)
const render = (template: string, options: Partial<Parameters<typeof renderText>[0]> = {}) => renderText({ form, data: { ...data.fields, defs: { due: '2030-01-02' } }, template, ...options })
const check = (template: string) => checkTextTemplate(template, env, { values: resolver })

describe('the part modifier on template placeholders', () => {
  it('prints the parts of dates, phones and money, in loops and triple braces', () => {
    expect(render('{{ fields.dob | part="year" }}/{{ fields.dob | part="month" }}/{{{ fields.dob | part="day" }}}')).toBe('2021/06/05')
    expect(render('+{{ fields.home | part="countryCode" }} ({{ fields.home | part="areaCode" }}) {{ fields.home | part="subscriberNumber" }}')).toBe('+1 (212) 5551234')
    expect(render('{{ fields.big | part="units" }}.{{ fields.big | part="cents" }}', { format: { money: { currencyDisplay: 'none' } } })).toBe('1234.50')
    expect(render('{{#each fields.lines}}{{ item.on | part="year" }}{{/each}}')).toBe('2024')
    expect(render('{{ due | part="year" }}')).toBe('2030')
    expect(check('{{ fields.dob | part="year" }}{{#each fields.lines}}{{ item.on | part="day" }}{{/each}}{{ fields.home | part="extension" }}')).toEqual([])
  })

  it('prints as before without the modifier', () => {
    expect(render('{{ fields.dob }}')).toBe('Jun 5, 2021')
  })

  it('refuses at render a part the value does not have', () => {
    expect(() => render('{{ fields.uk | part="areaCode" }}')).toThrowError(/exists only for \+1 numbers/)
    expect(() => render('{{ fields.refund | part="units" }}')).toThrowError(/zero or more/)
    expect(() => render('{{ fields.uk | part="nationalNumber", phone.region="US" }}')).toThrowError(/calling code \+44/)
    expect(render('{{ fields.home | part="nationalNumber", phone.region="US" }}')).toBe('2125551234')
  })

  it('prints a missing value as a progressive preview prints it', () => {
    expect(render('[{{ fields.dob | part="year" }}]', { data: {} })).toBe('[]')
    expect(render('[{{ fields.dob | part="year" }}]', { data: {}, progressive: { missing: '___' } })).toBe('[___]')
  })

  it('refuses an unknown part and a part of another kind at check and at render', () => {
    const cases: Array<[string, RegExp]> = [
      ['{{ fields.dob | part="week" }}', /part takes "year", "month", "day", .*not "week"/],
      ['{{ fields.dob | part=2 }}', /part takes .*not 2/],
      ['{{ fields.dob | part="units" }}', /A date value has no part "units"; its parts are "year", "month", "day"/],
      ['{{ fields.note | part="year" }}', /part applies to date, phone and money values, not to fields\.note, a text value/],
      ['{{ "2021-01-01" | part="year" }}', /not to a string value/],
    ]
    for (const [template, message] of cases) {
      expect(check(template), template).toEqual([expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(message) })])
      expect(() => render(template), template).toThrowError(TemplateError)
    }
  })

  it('reads the part modifier in a Word template', async () => {
    const encoder = new TextEncoder()
    const docx = zipSync({
      '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'word/document.xml': encoder.encode('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">{{ fields.dob | part=“year” }}</w:t></w:r></w:p></w:body></w:document>'),
    })
    expect(await checkDocxTemplate(docx, env, { values: resolver })).toEqual([])
    const rendered = await renderDocx({ template: docx, form, data: data.fields })
    expect(new TextDecoder().decode(unzipSync(rendered)['word/document.xml'])).toContain('>2021<')
  })
})
