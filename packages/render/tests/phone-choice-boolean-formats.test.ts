import type { Bindings, Form, LayerFormat } from '@asterdoc/types'
import { createFormatter } from '@asterdoc/format'
import { phoneProvider } from '@asterdoc/format/phone'
import { zipSync, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { defaultFormatter } from '../src/index'
import { checkPdfBindingFit, extractPdfData, findPdfLabelCollisions, PdfFieldFillError, renderPdf } from '../src/pdf'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { ArtifactFieldFormatError, renderText } from '../src/text'
import { renderDocx } from '../src/docx'
import { acroFieldsPdf, acroFormPdf, type AcroFormFixtureField, type FixtureField } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'phone-choice-boolean',
  version: '1.0.0',
  fields: {
    us: { type: 'phone' },
    uk: { type: 'phone' },
    sg: { type: 'phone' },
    status: { type: 'enum', enum: [{ value: 'S', label: 'Single' }, { value: 'M', label: 'Married' }] },
    colors: { type: 'multiselect', enum: [{ value: 'r', label: 'Red' }, { value: 'g', label: 'Green' }, { value: 'b', label: 'Blue' }] },
    wed: { type: 'boolean' },
  },
} as unknown as Form

const data = {
  fields: {
    us: { number: '+12125551234' },
    uk: { number: '+442079460958', extension: '42' },
    sg: '+6565123456',
    status: 'M',
    colors: ['r', 'b'],
    wed: true,
  },
}

const textBoxes = (...names: string[]): AcroFormFixtureField[] => names.map((name) => ({ kind: 'text', name }))

async function values(pdf: Uint8Array): Promise<Record<string, unknown>> {
  return Object.fromEntries((await inspectAcroFormFields(pdf, { includeButton: true })).map((field) => [field.name, field.value]))
}

async function fill(bindings: Bindings, format?: LayerFormat, fields: AcroFormFixtureField[] = textBoxes(...Object.keys(bindings))) {
  return values(await renderPdf({ template: acroFormPdf(fields), form, data, bindings, ...(format && { format }) }))
}

async function renderError(run: () => Promise<unknown>): Promise<ArtifactFieldFormatError> {
  const error = await run().then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(ArtifactFieldFormatError)
  return error as ArtifactFieldFormatError
}

describe('a phone style on a PDF layer', () => {
  it('prints each style for US, UK and a number without area codes', async () => {
    const bindings: Bindings = { us: 'us', uk: 'uk', sg: 'sg' }
    expect(await fill(bindings, { phone: { style: 'international' } })).toEqual({ us: '+1 212 555 1234', uk: '+44 20 7946 0958 ext. 42', sg: '+65 6512 3456' })
    expect(await fill(bindings, { phone: { style: 'national' } })).toEqual({ us: '(212) 555-1234', uk: '020 7946 0958 ext. 42', sg: '6512 3456' })
    expect(await fill(bindings, { phone: { style: 'digits' } })).toEqual({ us: '2125551234', uk: '2079460958 ext. 42', sg: '65123456' })
    expect(await fill(bindings, { phone: { style: 'e164' } })).toEqual({ us: '+12125551234', uk: '+442079460958 ext. 42', sg: '+6565123456' })
  })

  it('prints the stored number with no phone format, as before', async () => {
    expect(await fill({ us: 'us', uk: 'uk' })).toEqual({ us: '+12125551234', uk: '+442079460958 ext. 42' })
  })

  it('lets a binding style override the layer style for its own value', async () => {
    const bindings: Bindings = { us: { path: 'us', format: { phone: { style: 'digits' } } }, sg: 'sg' }
    expect(await fill(bindings, { phone: { style: 'national' } })).toEqual({ us: '2125551234', sg: '6512 3456' })
  })

  it('styles a bound phone number member alone, keeping the extension in its own box', async () => {
    const bindings: Bindings = { number: 'uk.number', ext: 'uk.extension' }
    expect(await fill(bindings, { phone: { style: 'national', region: 'GB' } })).toEqual({ number: '020 7946 0958', ext: '42' })
    expect(await fill(bindings)).toEqual({ number: '+442079460958', ext: '42' })
  })

  it('refuses a national number of another plan than phone.region names', async () => {
    const error = await renderError(() => renderPdf({ template: acroFormPdf(textBoxes('uk')), form, data, bindings: { uk: 'uk' }, format: { phone: { style: 'national', region: 'US' } } }))
    expect(error.issues[0]).toMatchObject({ code: 'phone_region_mismatch', path: 'fields.uk.number' })
    expect(await fill({ uk: 'uk' }, { phone: { style: 'international', region: 'US' } })).toEqual({ uk: '+44 20 7946 0958 ext. 42' })
  })

  it('refuses a number no plan accepts, and only when a binding reads it', async () => {
    const invalid = { fields: { ...data.fields, sg: '+15555555555' } }
    const format: LayerFormat = { phone: { style: 'national' } }
    const error = await renderError(() => renderPdf({ template: acroFormPdf(textBoxes('sg')), form, data: invalid, bindings: { sg: 'sg' }, format }))
    expect(error.issues[0]).toMatchObject({ code: 'invalid_phone' })
    const unused = await renderPdf({ template: acroFormPdf(textBoxes('us')), form, data: invalid, bindings: { us: 'us' }, format })
    expect(await values(unused)).toEqual({ us: '(212) 555-1234' })
  })

  it('fails with missing_format_provider when the caller formatter has no phone provider', async () => {
    const error = await renderError(() => renderPdf({ template: acroFormPdf(textBoxes('us')), form, data, bindings: { us: 'us' }, format: { phone: { style: 'national' } }, formatter: createFormatter() }))
    expect(error.issues[0]).toMatchObject({ code: 'missing_format_provider' })
    expect(error.issues[0]!.message).toContain('@asterdoc/format/phone')
    expect(defaultFormatter.providers.phone).toBe(phoneProvider)
  })
})

describe('a choice display on a PDF layer', () => {
  const fields: AcroFormFixtureField[] = [
    ...textBoxes('statusText', 'colorsText'),
    { kind: 'choice', name: 'statusDrop', options: ['S', 'M'] },
    { kind: 'checkbox', name: 'married', onState: 'Yes' },
    { kind: 'checkbox', name: 'wedBox', onState: 'Yes' },
  ]
  const bindings: Bindings = { statusText: 'status', colorsText: 'colors', statusDrop: 'status', married: 'status:M', wedBox: 'wed' }

  it('prints option values in text boxes by default, as before', async () => {
    expect(await fill(bindings, undefined, fields)).toMatchObject({ statusText: 'M', colorsText: 'r, b', statusDrop: ['M'], married: true })
  })

  it('prints labels in text boxes under label display, and leaves export values untouched', async () => {
    expect(await fill(bindings, { choice: { display: 'label' } }, fields)).toMatchObject({ statusText: 'Married', colorsText: 'Red and Blue', statusDrop: ['M'], married: true, wedBox: true })
  })

  it('lets a binding choose values under a layer that prints labels', async () => {
    const own: Bindings = { statusText: { path: 'status', format: { choice: { display: 'value' } } }, colorsText: 'colors' }
    expect(await fill(own, { choice: { display: 'label' } })).toEqual({ statusText: 'M', colorsText: 'Red and Blue' })
  })
})

describe('boolean labels on a PDF layer', () => {
  it('print in a text box and leave a checkbox its state', async () => {
    const fields: AcroFormFixtureField[] = [...textBoxes('wedText'), { kind: 'checkbox', name: 'wedBox', onState: 'Yes' }]
    const bindings: Bindings = { wedText: 'wed', wedBox: 'wed' }
    expect(await fill(bindings, undefined, fields)).toMatchObject({ wedText: 'Yes', wedBox: true })
    expect(await fill(bindings, { boolean: { trueLabel: 'X', falseLabel: '' } }, fields)).toMatchObject({ wedText: 'X', wedBox: true })
  })
})

describe('text and DOCX layers', () => {
  const template = '{{fields.us}} | {{fields.status}} | {{fields.colors}} | {{fields.wed}}'

  it('print as before with no format', () => {
    expect(renderText({ template, form, data })).toBe('+12125551234 | Married | Red and Blue | Yes')
  })

  it('print phone styles, choice values and boolean labels from the layer format', () => {
    const format: LayerFormat = { phone: { style: 'national' }, choice: { display: 'value' }, boolean: { trueLabel: 'Oui', falseLabel: 'Non' } }
    expect(renderText({ template, form, data, format })).toBe('(212) 555-1234 | M | r, b | Oui')
  })

  it('carry the format into a DOCX document', async () => {
    const encoder = new TextEncoder()
    const docx = zipSync({
      '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'word/document.xml': encoder.encode(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${template}</w:t></w:r></w:p></w:body></w:document>`),
    })
    const output = await renderDocx({ template: docx, form, data, format: { phone: { style: 'digits' }, boolean: { trueLabel: 'Y' } } })
    const visible = [...new TextDecoder().decode(unzipSync(output)['word/document.xml']).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join('')
    expect(visible).toBe('2125551234 | Married | Red and Blue | Y')
  })
})

describe('the fit check of the new outputs', () => {
  const COMB = 1 << 24
  const box = (name: string, width: number, extra: Partial<FixtureField> = {}): FixtureField => ({ name, rect: [20, 20, 20 + width, 34], ...extra })
  const check = (fields: FixtureField[], bindings: Bindings, format?: LayerFormat) =>
    checkPdfBindingFit({ template: acroFieldsPdf(fields), form, bindings, ...(format && { format }) })

  const fails = async (fields: FixtureField[], bindings: Bindings, format: LayerFormat, values: Record<string, unknown>) => {
    const error = await renderPdf({ template: acroFieldsPdf(fields), form, data: { fields: { ...data.fields, ...values } }, bindings, format })
      .then(() => undefined, (caught: unknown) => caught)
    return error instanceof PdfFieldFillError ? error.reason : undefined
  }

  it('checks a national or digits number at the longest number of phone.region, against a comb', async () => {
    const comb = [box('us', 200, { flags: COMB, maxLen: 10 })]
    expect(await check(comb, { us: 'us.number' }, { phone: { style: 'digits', region: 'US' } })).toEqual([])
    const anyPlan = await check(comb, { us: 'us.number' }, { phone: { style: 'digits' } })
    expect(anyPlan).toEqual([expect.objectContaining({ severity: 'error', reason: 'comb-length', limit: 10, length: 14 })])
    expect(anyPlan[0]!.message).toContain('phone style digits for any numbering plan')
    expect(await check(comb, { us: 'us.number' })).toEqual([])
  })

  it('checks an international number of any plan, even with phone.region, since it prints the calling code', async () => {
    const comb = [box('us', 300, { flags: COMB, maxLen: 15 })]
    const format: LayerFormat = { phone: { style: 'international', region: 'US' } }
    expect(await check(comb, { us: 'us.number' }, format)).toEqual([expect.objectContaining({ reason: 'comb-length', limit: 15 })])
    expect(await fails(comb, { us: 'us.number' }, format, { us: { number: '+442079460958' } })).toBe('comb-length')
  })

  it('counts the extension label and the longest extension for a whole phone, and not for its number', async () => {
    const comb = [box('us', 300, { flags: COMB, maxLen: 10 })]
    const format: LayerFormat = { phone: { style: 'digits', region: 'US' } }
    const whole = await check(comb, { us: 'us' }, format)
    expect(whole).toEqual([expect.objectContaining({ reason: 'comb-length', limit: 10, length: '0000000000 ext. '.length + 20 })])
    expect(await fails(comb, { us: 'us' }, format, { us: { number: '+12125551234', extension: '42' } })).toBe('comb-length')
    expect(await check(comb, { us: 'us.number' }, format)).toEqual([])
    expect(await fails(comb, { us: 'us.number' }, format, { us: { number: '+12125551234', extension: '42' } })).toBeUndefined()
  })

  it('measures the widest digit across a phone style\'s longest text', async () => {
    const narrow = [box('us', 40)]
    const issues = await check(narrow, { us: { path: 'us.number', format: { phone: { style: 'national', region: 'US' } } } })
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', reason: 'overflow', length: 14 })])
    expect(await fails(narrow, { us: 'us.number' }, { phone: { style: 'national' } }, { us: { number: '+18888888888' } })).toBe('overflow')
  })

  it('checks a comb against the longest label when the longest label is the narrowest', async () => {
    const pick = { ...form, fields: { pick: { type: 'enum', enum: [{ value: 'w', label: 'WWWW' }, { value: 'i', label: 'iiiiiiiiii' }] } } } as unknown as Form
    const fields = [box('pick', 300, { flags: COMB, maxLen: 5 })]
    const template = acroFieldsPdf(fields)
    const issues = await checkPdfBindingFit({ template, form: pick, bindings: { pick: 'pick' }, format: { choice: { display: 'label' } } })
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', reason: 'comb-length', limit: 5, length: 10 })])
    const filled = await renderPdf({ template, form: pick, data: { fields: { pick: 'i' } }, bindings: { pick: 'pick' }, format: { choice: { display: 'label' } } })
      .then(() => undefined, (caught: unknown) => caught)
    expect((filled as PdfFieldFillError).reason).toBe('comb-length')
  })

  it('checks a comb against the longest option value when it is the narrowest', async () => {
    const pick = { ...form, fields: { pick: { type: 'enum', enum: [{ value: 'WWWW' }, { value: 'iiiiiiiiii' }] } } } as unknown as Form
    const issues = await checkPdfBindingFit({ template: acroFieldsPdf([box('pick', 300, { flags: COMB, maxLen: 5 })]), form: pick, bindings: { pick: 'pick' } })
    expect(issues).toEqual([expect.objectContaining({ reason: 'comb-length', length: 10 })])
  })

  it('checks a comb against the longest boolean label when it is the narrowest', async () => {
    const fields = [box('wed', 300, { flags: COMB, maxLen: 5 })]
    const format: LayerFormat = { boolean: { trueLabel: 'WWWW', falseLabel: 'iiiiiiiiii' } }
    expect(await check(fields, { wed: 'wed' }, format)).toEqual([expect.objectContaining({ reason: 'comb-length', length: 10 })])
    expect(await fails(fields, { wed: 'wed' }, format, { wed: false })).toBe('comb-length')
  })

  it('checks a bounded multiselect at its longest permitted selection when that selection is the narrowest', async () => {
    const tags = {
      ...form,
      fields: { tags: { type: 'multiselect', max: 2, enum: [{ value: 'w', label: 'WWW' }, { value: 'x', label: 'WWW2' }, { value: 'i', label: 'iiiiiiiii' }, { value: 'j', label: 'jjjjjjjjj' }] } },
    } as unknown as Form
    const fields = [box('tags', 400, { flags: COMB, maxLen: 18 })]
    const template = acroFieldsPdf(fields)
    const format: LayerFormat = { choice: { display: 'label' } }
    const issues = await checkPdfBindingFit({ template, form: tags, bindings: { tags: 'tags' }, format })
    expect(issues).toEqual([expect.objectContaining({ reason: 'comb-length', length: 'iiiiiiiii and jjjjjjjjj'.length })])
    const filled = await renderPdf({ template, form: tags, data: { fields: { tags: ['i', 'j'] } }, bindings: { tags: 'tags' }, format })
      .then(() => undefined, (caught: unknown) => caught)
    expect((filled as PdfFieldFillError).reason).toBe('comb-length')
  })

  it('measures option labels under label display, the widest by glyph width', async () => {
    const wide = { ...form, fields: { pick: { type: 'enum', enum: [{ value: 'a', label: 'iiiiiiiiiiii' }, { value: 'b', label: 'WWWWWWWWWWWW' }] } } } as unknown as Form
    const fields = [box('pick', 40)]
    const template = acroFieldsPdf(fields)
    expect(await checkPdfBindingFit({ template, form: wide, bindings: { pick: 'pick' } })).toEqual([])
    const issues = await checkPdfBindingFit({ template, form: wide, bindings: { pick: 'pick' }, format: { choice: { display: 'label' } } })
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', reason: 'overflow' })])
    expect(issues[0]!.message).toContain('"WWWWWWWWWWWW"')
  })

  it('measures a multiselect\'s labels as the formatter lists them', async () => {
    const issues = await check([box('colors', 200, { flags: COMB, maxLen: 14 })], { colors: 'colors' }, { choice: { display: 'label' } })
    expect(issues).toEqual([expect.objectContaining({ reason: 'comb-length', length: 'Green, Blue, and Red'.length })])
  })

  it('measures boolean labels only once the format sets them', async () => {
    const fields = [box('wed', 200, { flags: COMB, maxLen: 3 })]
    expect(await check(fields, { wed: 'wed' })).toEqual([])
    expect(await check(fields, { wed: 'wed' }, { boolean: { trueLabel: 'X', falseLabel: 'Not married' } }))
      .toEqual([expect.objectContaining({ reason: 'comb-length', length: 11 })])
  })
})

describe('reading phone styles back', () => {
  async function readBack(bindings: Bindings, format: LayerFormat, fields?: AcroFormFixtureField[]) {
    const pdf = await renderPdf({ template: acroFormPdf(fields ?? textBoxes(...Object.keys(bindings))), form, data, bindings, format })
    return extractPdfData({ pdf, form, bindings, format })
  }
  const statuses = (result: Awaited<ReturnType<typeof readBack>>) => Object.fromEntries(result.report.entries.map((entry) => [entry.path, entry.status]))

  it('recovers e164 and international numbers from the printed calling code, with the extension', async () => {
    for (const style of ['e164', 'international'] as const) {
      const result = await readBack({ us: 'us', uk: 'uk' }, { phone: { style } })
      expect(result.data.fields).toEqual({ us: { number: '+12125551234' }, uk: { number: '+442079460958', extension: '42' } })
      expect(result.report.entries.every((entry) => entry.status === 'recovered' && entry.lossy === false)).toBe(true)
    }
  })

  it('reports national and digits numbers not recoverable without phone.region', async () => {
    for (const style of ['national', 'digits'] as const) {
      const result = await readBack({ us: 'us' }, { phone: { style } })
      expect(statuses(result)).toEqual({ us: 'not_recoverable' })
      expect(result.report.entries[0]!.reason).toContain('format.phone.region')
      expect(result.data.fields).toEqual({})
    }
  })

  it('recovers national and digits numbers in the plan phone.region names', async () => {
    for (const style of ['national', 'digits'] as const) {
      const us = await readBack({ us: 'us' }, { phone: { style, region: 'US' } })
      expect(us.data.fields).toEqual({ us: { number: '+12125551234' } })
      const member = await readBack({ number: { path: 'uk.number', format: { phone: { style, region: 'GB' } } } }, {})
      expect(member.data.fields).toEqual({ uk: { number: '+442079460958' } })
    }
  })

  it('reports text that is not a number of the plan unparseable', async () => {
    const pdf = acroFormPdf([{ kind: 'text', name: 'us', value: '020 7946' }])
    const result = await extractPdfData({ pdf, form, bindings: { us: 'us' }, format: { phone: { style: 'national', region: 'US' } } })
    expect(statuses(result)).toEqual({ us: 'unparseable' })
  })
})

describe('reading choice and boolean labels back', () => {
  const twins = {
    ...form,
    fields: {
      ...form.fields,
      kind: { type: 'enum', enum: [{ value: 'a', label: 'Same' }, { value: 'b', label: 'Same' }, { value: 'c', label: 'Other' }] },
      tags: { type: 'multiselect', enum: [{ value: 'x', label: 'A' }, { value: 'y', label: 'A' }, { value: 'z', label: 'B' }] },
    },
  } as unknown as Form
  const read = (pdf: Uint8Array, bindings: Bindings, format: LayerFormat, artifact: Form = form) => extractPdfData({ pdf, form: artifact, bindings, format })
  const status = async (result: ReturnType<typeof read>) => (await result).report.entries.map((entry) => entry.status)

  it('reads labels back to option values', async () => {
    const format: LayerFormat = { choice: { display: 'label' } }
    const bindings: Bindings = { status: 'status', colors: 'colors' }
    const pdf = await renderPdf({ template: acroFormPdf(textBoxes('status', 'colors')), form, data, bindings, format })
    const result = await read(pdf, bindings, format)
    expect(result.data.fields).toEqual({ status: 'M', colors: ['r', 'b'] })
  })

  it('reports a label two options share not recoverable', async () => {
    const format: LayerFormat = { choice: { display: 'label' } }
    const pdf = acroFormPdf([{ kind: 'text', name: 'kind', value: 'Same' }, { kind: 'text', name: 'tags', value: 'A and B' }])
    expect(await status(read(pdf, { kind: 'kind', tags: 'tags' }, format, twins))).toEqual(['not_recoverable', 'not_recoverable'])
    const other = acroFormPdf([{ kind: 'text', name: 'kind', value: 'Other' }])
    expect((await read(other, { kind: 'kind' }, format, twins)).data.fields).toEqual({ kind: 'c' })
  })

  it('reads boolean labels back to the boolean, then without regard to case', async () => {
    const format: LayerFormat = { boolean: { trueLabel: 'X', falseLabel: 'Blank' } }
    const one = (value: string) => read(acroFormPdf([{ kind: 'text', name: 'wed', value }]), { wed: 'wed' }, format)
    expect((await one('X')).data.fields).toEqual({ wed: true })
    expect((await one('blank')).data.fields).toEqual({ wed: false })
    expect((await one('Yes')).report.entries[0]!.status).toBe('unparseable')
  })

  it('reports equal boolean labels not recoverable', async () => {
    const pdf = acroFormPdf([{ kind: 'text', name: 'wed', value: 'Same' }])
    expect(await status(read(pdf, { wed: 'wed' }, { boolean: { trueLabel: 'Same', falseLabel: 'Same' } }))).toEqual(['not_recoverable'])
  })

  it('names the labels read-back cannot tell apart', () => {
    const collisions = findPdfLabelCollisions({ form: twins, bindings: { kind: 'kind', tags: 'tags', wed: 'wed', status: 'status' }, format: { choice: { display: 'label' }, boolean: { trueLabel: 'Y', falseLabel: 'Y' } } })
    expect(collisions.map(({ field, path }) => [field, path])).toEqual([['kind', 'fields.kind'], ['tags', 'fields.tags'], ['wed', 'fields.wed']])
    expect(collisions[0]!.message).toContain('"Same"')
    expect(findPdfLabelCollisions({ form: twins, bindings: { kind: 'kind' } })).toEqual([])
    expect(findPdfLabelCollisions({ form: twins, format: { choice: { display: 'label' } } }).map(({ field }) => field)).toEqual(['kind', 'tags'])
  })

  const crossed = {
    ...form,
    fields: {
      pick: { type: 'enum', enum: [{ value: 'a', label: 'b' }, { value: 'b', label: 'Bee' }] },
      picks: { type: 'multiselect', enum: [{ value: 'a', label: 'b' }, { value: 'b', label: 'Bee' }] },
    },
  } as unknown as Form
  const labelled: LayerFormat = { choice: { display: 'label' } }
  const roundTrip = async (fields: AcroFormFixtureField[], bindings: Bindings, values: Record<string, unknown>) => {
    const pdf = await renderPdf({ template: acroFormPdf(fields), form: crossed, data: { fields: values }, bindings, format: labelled })
    return extractPdfData({ pdf, form: crossed, bindings, format: labelled })
  }

  it('reads a radio button\'s export value as a value, never as a label', async () => {
    const result = await roundTrip([{ kind: 'radio', name: 'pick', states: ['a', 'b'] }], { pick: 'pick' }, { pick: 'b' })
    expect(result.data.fields).toEqual({ pick: 'b' })
    expect(result.report.entries[0]).toMatchObject({ status: 'recovered', lossy: false })
  })

  it('reads a dropdown\'s export value as a value, never as a label', async () => {
    const result = await roundTrip([{ kind: 'choice', name: 'pick', options: ['a', 'b'] }], { pick: 'pick' }, { pick: 'b' })
    expect(result.data.fields).toEqual({ pick: 'b' })
  })

  it('reads labels in a text box first, where a label equals another option\'s value', async () => {
    expect((await roundTrip(textBoxes('pick'), { pick: 'pick' }, { pick: 'a' })).data.fields).toEqual({ pick: 'a' })
    expect((await roundTrip(textBoxes('picks'), { picks: 'picks' }, { picks: ['b'] })).data.fields).toEqual({ picks: ['b'] })
    expect((await roundTrip(textBoxes('picks'), { picks: 'picks' }, { picks: ['a', 'b'] })).data.fields).toEqual({ picks: ['a', 'b'] })
  })

  it('reads a boolean label back exactly when another differs from it only by space', async () => {
    const format: LayerFormat = { boolean: { trueLabel: 'Y', falseLabel: ' Y ' } }
    for (const wed of [true, false]) {
      const pdf = await renderPdf({ template: acroFormPdf(textBoxes('wed')), form, data: { fields: { wed } }, bindings: { wed: 'wed' }, format })
      const result = await extractPdfData({ pdf, form, bindings: { wed: 'wed' }, format })
      expect(result.data.fields).toEqual({ wed })
    }
  })

  it('reports text that matches two boolean labels only after normalizing not recoverable', async () => {
    const format: LayerFormat = { boolean: { trueLabel: 'Y', falseLabel: 'y' } }
    const read = (value: string) => extractPdfData({ pdf: acroFormPdf([{ kind: 'text', name: 'wed', value }]), form, bindings: { wed: 'wed' }, format })
    expect((await read('Y')).data.fields).toEqual({ wed: true })
    expect((await read('y')).data.fields).toEqual({ wed: false })
    const typed = await read(' Y ')
    expect(typed.report.entries[0]!.status).toBe('not_recoverable')
    expect(typed.data.fields).toEqual({})
  })

  it('reports a choice label matched by two options only after normalizing not recoverable', async () => {
    const cased = { ...form, fields: { pick: { type: 'enum', enum: [{ value: 'u', label: 'Single' }, { value: 'l', label: 'single' }] } } } as unknown as Form
    const read = (value: string) => extractPdfData({ pdf: acroFormPdf([{ kind: 'text', name: 'pick', value }]), form: cased, bindings: { pick: 'pick' }, format: labelled })
    expect((await read('single')).data.fields).toEqual({ pick: 'l' })
    expect((await read('SINGLE')).report.entries[0]!.status).toBe('not_recoverable')
  })

  it('warns about labels equal apart from space and case', () => {
    const cased = { ...form, fields: { pick: { type: 'enum', enum: [{ value: 'u', label: 'Single' }, { value: 'l', label: 'single ' }] }, wed: { type: 'boolean' } } } as unknown as Form
    const found = findPdfLabelCollisions({ form: cased, bindings: { pick: 'pick', wed: 'wed' }, format: { choice: { display: 'label' }, boolean: { trueLabel: 'Y', falseLabel: ' y' } } })
    expect(found.map(({ field }) => field)).toEqual(['pick', 'wed'])
    expect(findPdfLabelCollisions({ form: cased, bindings: { wed: 'wed' }, format: { boolean: { trueLabel: 'Y', falseLabel: 'N' } } })).toEqual([])
  })
})

describe('reading e164 numbers back', () => {
  const lenient = { ...form, fields: { phone: { type: 'phone' } } } as unknown as Form
  const format: LayerFormat = { phone: { style: 'e164' } }

  it('inverts a number by its E.164 syntax, even one no numbering plan accepts, with its extension', async () => {
    for (const phone of [{ number: '+15555555555' }, { number: '+15555555555', extension: '7' }, { number: '+999123456' }]) {
      const pdf = await renderPdf({ template: acroFormPdf(textBoxes('phone', 'number')), form: lenient, data: { fields: { phone } }, bindings: { phone: 'phone', number: 'phone.number' }, format })
      const result = await extractPdfData({ pdf, form: lenient, bindings: { phone: 'phone', number: 'phone.number' }, format })
      expect(result.report.entries.map((entry) => entry.status)).toEqual(['recovered', 'recovered'])
      expect(result.data.fields).toEqual({ phone })
    }
  })

  it('refuses text that is not E.164', async () => {
    const result = await extractPdfData({ pdf: acroFormPdf([{ kind: 'text', name: 'phone', value: '555 5555' }]), form: lenient, bindings: { phone: 'phone' }, format })
    expect(result.report.entries[0]!.status).toBe('unparseable')
  })
})
