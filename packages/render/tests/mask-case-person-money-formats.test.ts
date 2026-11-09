import type { Bindings, Form, LayerFormat } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { checkPdfBindingFit, extractPdfData, findPdfLabelCollisions, renderPdf } from '../src/pdf'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { ArtifactFieldFormatError, renderText } from '../src/text'
import { renderDocx } from '../src/docx'
import { unzipSync, zipSync } from 'fflate'
import { acroFieldsPdf, acroFormPdf, type AcroFormFixtureField, type FixtureField } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'mask-case',
  version: '1.0.0',
  fields: {
    ssn: { type: 'text', mask: '###-##-####' },
    anumber: { type: 'text', mask: 'A-#########' },
    code: { type: 'text', mask: 'A-@@' },
    note: { type: 'text' },
    city: { type: 'text' },
    email: { type: 'email' },
    site: { type: 'uri' },
    id: { type: 'uuid' },
    status: { type: 'enum', enum: [{ value: 'single', label: 'Single' }, { value: 'married', label: 'Married' }] },
    agree: { type: 'boolean' },
    amount: { type: 'money', currency: 'USD' },
    client: { type: 'person' },
    nickname: { type: 'person' },
    home: { type: 'address' },
  },
  parties: { buyer: { partyType: 'person' } },
} as unknown as Form

const data = {
  fields: {
    ssn: '123456789',
    anumber: '012345678',
    code: 'xy',
    note: 'istanbul',
    city: 'springfield',
    email: 'jane@example.com',
    site: 'https://example.com/a',
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    status: 'married',
    agree: true,
    amount: { amount: 1234.5, currency: 'USD' },
    client: { name: 'Jane Q. Public', firstName: 'Jane', middleName: 'Q.', lastName: 'Public', title: 'Dr.' },
    nickname: { name: 'Janey' },
    home: { line1: '1 Main St', locality: 'Springfield', region: 'IL', postalCode: '62701', country: 'US' },
  },
  parties: { buyer: { name: 'Bo Buyer', firstName: 'Bo', lastName: 'Buyer' } },
}

const boxes = (...names: string[]): AcroFormFixtureField[] => names.map((name) => ({ kind: 'text', name }))

async function values(pdf: Uint8Array): Promise<Record<string, unknown>> {
  return Object.fromEntries((await inspectAcroFormFields(pdf, { includeButton: true })).map((field) => [field.name, field.value]))
}

async function fill(bindings: Bindings, format?: LayerFormat, filled: Record<string, unknown> = data, fields?: AcroFormFixtureField[]) {
  return values(await renderPdf({ template: acroFormPdf(fields ?? boxes(...Object.keys(bindings))), form, data: filled, bindings, ...(format && { format }) }))
}

const text = (template: string, format?: LayerFormat, filled: Record<string, unknown> = data, progressive?: { incomplete?: string }) =>
  renderText({ template, form, data: filled, ...(format && { format }), ...(progressive && { progressive }) })

const only = (...names: (keyof typeof data.fields)[]) => ({
  form: { ...form, parties: undefined, fields: Object.fromEntries(names.map((name) => [name, form.fields![name]!])) } as Form,
  data: { fields: Object.fromEntries(names.map((name) => [name, data.fields[name]])) },
})

const textOf = (names: (keyof typeof data.fields)[], template: string, format: LayerFormat) => renderText({ template, ...only(...names), format })

const withFields = (fields: Record<string, unknown>) => ({ ...data, fields: { ...data.fields, ...fields } })

function docxTemplate(paragraph: string): Uint8Array {
  const encoder = new TextEncoder()
  return zipSync({
    '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': encoder.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': encoder.encode(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${paragraph}</w:t></w:r></w:p></w:body></w:document>`),
  })
}

describe('a masked text field', () => {
  it('prints with its mask in a text layer, without masks, or with another mask per placeholder', () => {
    expect(text('{{fields.ssn}} {{fields.anumber}}')).toBe('123-45-6789 A-012345678')
    expect(text('{{fields.ssn}} {{fields.anumber}}', { text: { mask: false } })).toBe('123456789 012345678')
    expect(text('{{fields.ssn}}', { text: { mask: true } })).toBe('123-45-6789')
    expect(text('{{ fields.ssn | text.mask="### ## ####" }} {{ fields.note | text.mask="@@@@-@@@@" }} {{fields.code}}')).toBe('123 45 6789 ista-nbul A-xy')
  })

  it('fails with mask_mismatch when a stored value does not fit, except in a progressive preview', () => {
    const short = withFields({ ssn: '12345' })
    const error = (() => { try { text('{{fields.ssn}}', undefined, short) } catch (caught) { return caught } })()
    expect(error).toBeInstanceOf(ArtifactFieldFormatError)
    expect((error as ArtifactFieldFormatError).issues[0]).toMatchObject({ code: 'mask_mismatch', path: 'fields.ssn' })
    expect(text('{{fields.ssn}}', undefined, short, { incomplete: '[…]' })).toBe('[…]')
    expect(() => text('{{fields.ssn}}', undefined, withFields({ ssn: '12345678X' }), { incomplete: '[…]' })).toThrow(ArtifactFieldFormatError)
  })

  it('takes the per-value path in a PDF with no layer format, for plain and split bindings', async () => {
    expect(await fill({ ssn: 'ssn', a: 'anumber', s1: 'ssn:1', s2: 'ssn:2', s3: 'ssn:3', a1: 'anumber:1' })).toMatchObject({
      ssn: '123-45-6789', a: 'A-012345678', s1: '123', s2: '45', s3: '6789', a1: '012345678',
    })
    expect(await fill({ ssn: { path: 'ssn', format: { text: { mask: false } } } })).toMatchObject({ ssn: '123456789' })
  })

  it('fills a masked field by its id, and leaves the hyphen split for fields without a mask', async () => {
    const pdf = await renderPdf({ template: acroFormPdf(boxes('ssn')), form, data })
    expect(await values(pdf)).toMatchObject({ ssn: '123-45-6789' })
    expect(await fill({ n1: 'note:1' }, undefined, withFields({ note: 'ab-cd' }))).toMatchObject({ n1: 'ab' })
  })

  it('fails at render for a mismatched value a binding reads, and only for that one', async () => {
    const bad = withFields({ ssn: '12-345' })
    await expect(fill({ ssn: 'ssn' }, undefined, bad)).rejects.toThrow(/mask/)
    await expect(fill({ s2: 'ssn:2' }, undefined, bad)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: 'mask_mismatch' })] })
    expect(await fill({ a: 'anumber' }, undefined, bad)).toMatchObject({ a: 'A-012345678' })
  })
})

describe('case', () => {
  it('upper-cases a text layer, but not email, uri or uuid values', () => {
    const printed = text('{{fields.city}}|{{fields.status}}|{{fields.email}}|{{fields.site}}|{{fields.id}}|{{parties.buyer}}', { case: 'upper' })
    expect(printed).toBe(`SPRINGFIELD|MARRIED|jane@example.com|https://example.com/a|${data.fields.id}|BO BUYER`)
  })

  it('applies the locale\'s rules', () => {
    expect(textOf(['note'], '{{fields.note}}', { case: 'upper', locale: 'tr-TR' })).toBe('İSTANBUL')
    expect(textOf(['note'], '{{fields.note}}', { case: 'upper', locale: 'en-US' })).toBe('ISTANBUL')
  })

  it('reaches members of structured values and computed text in text and Word layers, but not email, uri or uuid', async () => {
    const template = '{{fields.home.locality}}|{{fields.home.region}}|{{fields.client.lastName}}|{{parties.buyer.lastName}}|{{fields.email}}|{{fields.site}}|{{fields.id}}|{{fields.home.postalCode}}'
    const expected = `SPRINGFIELD|IL|PUBLIC|BUYER|jane@example.com|https://example.com/a|${data.fields.id}|62701`
    expect(text(template, { case: 'upper' })).toBe(expected)
    expect(text(template)).toBe(`Springfield|IL|Public|Buyer|jane@example.com|https://example.com/a|${data.fields.id}|62701`)
    const word = await renderDocx({ template: docxTemplate(template), form, data, format: { case: 'upper' } })
    expect(new TextDecoder().decode(unzipSync(word)['word/document.xml'])).toContain(expected)
  })

  it('leaves a progressive placeholder as the policy writes it', () => {
    expect(text('{{fields.ssn}}|{{fields.city}}', { case: 'upper' }, withFields({ ssn: '12345' }), { incomplete: '[pending]' })).toBe('[pending]|SPRINGFIELD')
  })

  it('applies after the mask and after a join', async () => {
    expect(text('{{fields.code}}', { case: 'upper' })).toBe('A-XY')
    expect(await fill({ both: { path: 'city, email', format: { case: 'upper' } } })).toMatchObject({ both: 'SPRINGFIELD, JANE@EXAMPLE.COM' })
    expect(await fill({ both: 'city, email' }, { case: 'upper' })).toMatchObject({ both: 'SPRINGFIELD, jane@example.com' })
  })

  it('applies to any text box from a binding, and a binding turns a layer upper off with none', async () => {
    expect(await fill({ email: { path: 'email', format: { case: 'upper' } }, city: 'city', home: 'home.locality' }, undefined)).toMatchObject({ email: 'JANE@EXAMPLE.COM', city: 'springfield', home: 'Springfield' })
    expect(await fill({ city: { path: 'city', format: { case: 'none' } }, note: 'note', home: 'home.locality', email: 'email' }, { case: 'upper' }))
      .toMatchObject({ city: 'springfield', note: 'ISTANBUL', home: 'SPRINGFIELD', email: 'jane@example.com' })
  })

  it('never changes checkbox, radio or dropdown export values', async () => {
    const fields: AcroFormFixtureField[] = [
      { kind: 'choice', name: 'status', options: ['single', 'married'] },
      { kind: 'checkbox', name: 'agree' },
      { kind: 'text', name: 'statusText' },
    ]
    const printed = await fill({ status: 'status', agree: 'agree', statusText: 'status' }, { case: 'upper' }, data, fields)
    expect(printed).toMatchObject({ status: ['married'], agree: true, statusText: 'MARRIED' })
    expect(await fill({ status: { path: 'status', format: { case: 'upper' } } }, undefined, data, fields)).toMatchObject({ status: ['married'] })
  })
})

describe('person order', () => {
  it('prints family-first in text and PDF layers, and the name as given without parts', async () => {
    expect(text('{{fields.client}}; {{fields.nickname}}; {{parties.buyer}}', { person: { order: 'family-first' } })).toBe('Public, Jane Q.; Janey; Buyer, Bo')
    expect(text('{{fields.client}}')).toBe('Jane Q. Public')
    expect(await fill({ client: { path: 'client', format: { person: { order: 'family-first' } } }, plain: 'client' })).toMatchObject({ client: 'Public, Jane Q.', plain: 'Jane Q. Public' })
  })
})

describe('money digits and grouping', () => {
  it('rounds to whole units and drops grouping on a layer or a binding', async () => {
    expect(text('{{fields.amount}}', { money: { fractionDigits: 0 } })).toBe('$1,235')
    expect(text('{{fields.amount}}', { money: { useGrouping: false } })).toBe('$1234.50')
    expect(await fill({ whole: { path: 'amount', format: { money: { fractionDigits: 0 } } }, plain: 'amount' }, { money: { currencyDisplay: 'none' } }))
      .toMatchObject({ whole: '1,235', plain: '1,234.50' })
  })
})

describe('the fit check', () => {
  const box = (name: string, width: number, extra: Partial<FixtureField> = {}): FixtureField => ({ name, rect: [20, 20, 20 + width, 32], ...extra })
  const masks = { kind: 'form', name: 'fit', version: '1.0.0', fields: {
    letters: { type: 'text', mask: '@@@@@@@@@@' },
    digits: { type: 'text', mask: '##########' },
    dashed: { type: 'text', mask: '###-##-####' },
    sharp: { type: 'text', pattern: '^ß{5}$' },
  } } as unknown as Form

  it('fills a letter mask with the widest letter, and a digit mask with the widest digit', async () => {
    const template = acroFieldsPdf([box('letters', 40), box('digits', 40)])
    const issues = await checkPdfBindingFit({ template, form: masks, bindings: { letters: 'letters', digits: 'digits' } })
    expect(issues.map((issue) => issue.field)).toEqual(['letters'])
    expect(issues[0]!.message).toContain('mask @@@@@@@@@@')
  })

  it('counts the literals a mask prints, and none once the binding prints without them', async () => {
    const template = acroFieldsPdf([box('dashed', 200, { flags: 1 << 24, maxLen: 9 })])
    const printed = await checkPdfBindingFit({ template, form: masks, bindings: { dashed: 'dashed' } })
    expect(printed).toEqual([expect.objectContaining({ reason: 'comb-length', length: 11 })])
    expect(await checkPdfBindingFit({ template, form: masks, bindings: { dashed: { path: 'dashed', format: { text: { mask: false } } } } })).toEqual([])
  })

  it('counts comb characters after case', async () => {
    const template = acroFieldsPdf([box('sharp', 200, { flags: 1 << 24, maxLen: 5 })])
    expect(await checkPdfBindingFit({ template, form: masks, bindings: { sharp: 'sharp' } })).toEqual([])
    expect(await checkPdfBindingFit({ template, form: masks, bindings: { sharp: 'sharp' }, format: { case: 'upper' } }))
      .toEqual([expect.objectContaining({ reason: 'comb-length', length: 10 })])
  })
})

describe('reading a PDF back', () => {
  async function readBack(bindings: Bindings, format?: LayerFormat, filled: Record<string, unknown> = data) {
    const pdf = await renderPdf({ template: acroFormPdf(boxes(...Object.keys(bindings))), form, data: filled, bindings, ...(format && { format }) })
    return extractPdfData({ pdf, form, bindings, ...(format && { format }) })
  }
  const entry = (result: Awaited<ReturnType<typeof readBack>>, path: string) => result.report.entries.find((item) => item.path === path)

  it('canonicalizes a masked value printed with or without its mask, or in groups', async () => {
    const printed = await readBack({ ssn: 'ssn', a: { path: 'anumber', format: { text: { mask: false } } } })
    expect(printed.data.fields).toEqual({ ssn: '123456789', anumber: '012345678' })
    expect(entry(printed, 'ssn')).toMatchObject({ status: 'recovered', lossy: false })
    const groups = await readBack({ s1: 'ssn:1', s2: 'ssn:2', s3: 'ssn:3' })
    expect(groups.data.fields).toEqual({ ssn: '123456789' })
    const partial = await readBack({ s1: 'ssn:1', s2: 'ssn:2' })
    expect(entry(partial, 'ssn')).toMatchObject({ status: 'not_recoverable' })
  })

  it('refuses a masked box whose text does not fit the mask', async () => {
    const pdf = acroFormPdf([{ kind: 'text', name: 'ssn', value: '12-345' }])
    const result = await extractPdfData({ pdf, form, bindings: { ssn: 'ssn' } })
    expect(entry(result, 'ssn')).toMatchObject({ status: 'unparseable', reason: expect.stringContaining('Expected ###-##-####') })
  })

  it('marks upper-cased letters lossy, and digits or skipped types exact', async () => {
    const result = await readBack({ city: 'city', ssn: 'ssn', email: 'email' }, { case: 'upper' })
    expect(result.data.fields).toMatchObject({ city: 'SPRINGFIELD', ssn: '123456789', email: 'jane@example.com' })
    expect(entry(result, 'city')).toMatchObject({ lossy: true })
    expect(entry(result, 'ssn')).toMatchObject({ lossy: false })
    expect(entry(result, 'email')).toMatchObject({ lossy: false })
    const bound = await readBack({ email: { path: 'email', format: { case: 'upper' } } })
    expect(entry(bound, 'email')).toMatchObject({ status: 'recovered', lossy: true })
  })

  it('reads whole units lossy and ungrouped amounts exact', async () => {
    const whole = await readBack({ amount: 'amount' }, { money: { fractionDigits: 0 } })
    expect(whole.data.fields).toEqual({ amount: { amount: 1235, currency: 'USD' } })
    expect(entry(whole, 'amount')).toMatchObject({ status: 'recovered', lossy: true })
    const ungrouped = await readBack({ amount: 'amount' }, { money: { useGrouping: false } })
    expect(ungrouped.data.fields).toEqual({ amount: { amount: 1234.5, currency: 'USD' } })
    expect(entry(ungrouped, 'amount')).toMatchObject({ status: 'recovered', lossy: false })
  })

  it('does not split a family-first name back into its parts', async () => {
    const result = await readBack({ client: 'client', last: 'client.lastName' }, { person: { order: 'family-first' } })
    expect(entry(result, 'client')).toMatchObject({ status: 'not_recoverable', reason: expect.stringContaining('family-first') })
    expect(entry(result, 'client.lastName')).toMatchObject({ status: 'recovered' })
  })
})

describe('choices that collide once upper-cased', () => {
  const choices = {
    kind: 'form',
    name: 'choices',
    version: '1.0.0',
    fields: {
      grade: { type: 'enum', enum: [{ value: 'a', label: 'Low a' }, { value: 'A', label: 'High A' }, { value: 'b', label: 'Bee' }] },
      street: { type: 'enum', enum: [{ value: 'one', label: 'Straße' }, { value: 'two', label: 'STRASSE' }, { value: 'three', label: 'Weg' }] },
      tags: { type: 'multiselect', enum: [{ value: 'x', label: 'Ex' }, { value: 'X', label: 'Big ex' }, { value: 'y', label: 'Why' }] },
    },
  } as unknown as Form
  const bindings: Bindings = { grade: 'grade', street: 'street', tags: 'tags' }
  const layer = (format: LayerFormat) => format
  const read = async (values: Record<string, unknown>, format: LayerFormat) => {
    const pdf = await renderPdf({ template: acroFormPdf(boxes('grade', 'street', 'tags')), form: choices, data: { fields: values }, bindings, format })
    const result = await extractPdfData({ pdf, form: choices, bindings, format })
    return Object.fromEntries(result.report.entries.filter((entry) => entry.status !== 'empty').map((entry) => [entry.path, entry.status === 'recovered' ? entry : entry.status]))
  }

  it('warns about option values and labels equal in upper case', () => {
    const values = findPdfLabelCollisions({ form: choices, bindings, format: layer({ case: 'upper' }) })
    expect(values.map(({ field, message }) => [field, message.includes('in upper case')])).toEqual([['grade', true], ['tags', true]])
    const labels = findPdfLabelCollisions({ form: choices, bindings, format: layer({ case: 'upper', choice: { display: 'label' } }) })
    expect(labels.map(({ field }) => field)).toEqual(['street'])
    expect(findPdfLabelCollisions({ form: choices, bindings, format: layer({ choice: { display: 'label' } }) })).toEqual([])
    expect(findPdfLabelCollisions({ form: choices, bindings })).toEqual([])
    expect(findPdfLabelCollisions({ form: choices, bindings: { grade: { path: 'grade', format: { case: 'none' } } }, format: layer({ case: 'upper' }) })).toEqual([])
  })

  it('reads a colliding value back as not recoverable, and a distinct one exactly', async () => {
    expect(await read({ grade: 'a', tags: ['x', 'y'] }, { case: 'upper' })).toEqual({ grade: 'not_recoverable', tags: 'not_recoverable' })
    expect(await read({ grade: 'b', tags: ['y'] }, { case: 'upper' })).toMatchObject({ grade: { status: 'recovered', lossy: false }, tags: { status: 'recovered' } })
    expect(await read({ street: 'one' }, { case: 'upper', choice: { display: 'label' } })).toEqual({ street: 'not_recoverable' })
    expect(await read({ street: 'three' }, { case: 'upper', choice: { display: 'label' } })).toMatchObject({ street: { status: 'recovered' } })
    expect(await read({ grade: 'a' }, {})).toMatchObject({ grade: { status: 'recovered' } })
  })
})

describe('upper case with letters case changes', () => {
  const cased = {
    kind: 'form',
    name: 'cased',
    version: '1.0.0',
    fields: {
      agree: { type: 'boolean' },
      code: { type: 'text', mask: 'a-@@' },
      pair: { type: 'text', mask: 'a-@@-@@' },
      kind: { type: 'enum', enum: [{ value: 'w', label: 'WWW' }, { value: 's', label: 'ßß' }] },
    },
  } as unknown as Form
  const fill = async (bindings: Bindings, fields: Record<string, unknown>, format?: LayerFormat) => {
    const pdf = await renderPdf({ template: acroFormPdf(boxes(...Object.keys(bindings))), form: cased, data: { fields }, bindings, ...(format && { format }) })
    return { pdf, printed: await values(pdf), read: await extractPdfData({ pdf, form: cased, bindings, ...(format && { format }) }) }
  }
  const entry = (read: Awaited<ReturnType<typeof extractPdfData>>, path: string) => read.report.entries.find((item) => item.path === path)

  it('reads boolean labels equal once upper-cased as not recoverable, whatever the answer', async () => {
    const format: LayerFormat = { case: 'upper', boolean: { trueLabel: 'Straße', falseLabel: 'STRASSE' } }
    for (const agree of [true, false]) {
      const { printed, read } = await fill({ agree: 'agree' }, { agree }, format)
      expect(printed.agree).toBe('STRASSE')
      expect(entry(read, 'agree')).toMatchObject({ status: 'not_recoverable' })
      expect(read.data.fields).toEqual({})
    }
    const { read } = await fill({ agree: 'agree' }, { agree: true }, { boolean: { trueLabel: 'Straße', falseLabel: 'STRASSE' } })
    expect(entry(read, 'agree')).toMatchObject({ status: 'recovered', lossy: false })
    expect(read.data.fields).toEqual({ agree: true })
  })

  it('checks the comb count of the candidate that is longest once upper-cased', async () => {
    const template = acroFieldsPdf([{ name: 'kind', rect: [20, 20, 220, 32], flags: 1 << 24, maxLen: 3 }])
    const format: LayerFormat = { case: 'upper', choice: { display: 'label' } }
    expect(await checkPdfBindingFit({ template, form: cased, bindings: { kind: 'kind' }, format: { choice: { display: 'label' } } })).toEqual([])
    expect(await checkPdfBindingFit({ template, form: cased, bindings: { kind: 'kind' }, format })).toEqual([expect.objectContaining({ reason: 'comb-length', length: 4 })])
    await expect(renderPdf({ template, form: cased, data: { fields: { kind: 's' } }, bindings: { kind: 'kind' }, format })).rejects.toThrow()
  })

  it('reads a mask whose literals print upper-cased, from a layer or a binding', async () => {
    const layer = await fill({ code: 'code' }, { code: 'xy' }, { case: 'upper' })
    expect(layer.printed.code).toBe('A-XY')
    expect(entry(layer.read, 'code')).toMatchObject({ status: 'recovered', lossy: true })
    expect(layer.read.data.fields).toEqual({ code: 'XY' })
    const binding = await fill({ code: { path: 'code', format: { case: 'upper' } } }, { code: 'xy' })
    expect(binding.printed.code).toBe('A-XY')
    expect(binding.read.data.fields).toEqual({ code: 'XY' })
    const plain = await fill({ code: 'code' }, { code: 'xy' })
    expect(plain.printed.code).toBe('a-xy')
    expect(entry(plain.read, 'code')).toMatchObject({ status: 'recovered', lossy: false })
  })

  it('prints mask groups in the layer\'s case and marks the case loss when reading them back', async () => {
    const { printed, read } = await fill({ code1: 'code:1', g1: 'pair:1', g2: 'pair:2' }, { code: 'xy', pair: 'xyzw' }, { case: 'upper' })
    expect(printed).toMatchObject({ code1: 'XY', g1: 'XY', g2: 'ZW' })
    expect(entry(read, 'pair')).toMatchObject({ status: 'recovered', lossy: true })
    expect(read.data.fields).toMatchObject({ pair: 'XYZW' })
    const plain = await fill({ g1: 'pair:1', g2: 'pair:2' }, { pair: 'xyzw' })
    expect(plain.printed).toMatchObject({ g1: 'xy', g2: 'zw' })
    expect(entry(plain.read, 'pair')).toMatchObject({ status: 'recovered', lossy: false })
  })
})

describe('parts under money digits, grouping and case', () => {
  const parts = {
    kind: 'form',
    name: 'parts',
    version: '1.0.0',
    fields: { amount: { type: 'money', currency: 'USD' }, dob: { type: 'date' } },
  } as unknown as Form
  const filled = { fields: { amount: { amount: 1234.5, currency: 'USD' }, dob: '2021-06-15' } }
  const bindings: Bindings = {
    units: { path: 'amount', part: 'units' },
    cents: { path: 'amount', part: 'cents' },
    year: { path: 'dob', part: 'year' },
    whole: 'amount',
  }
  const fill = async (format: LayerFormat, own: Bindings = bindings) => {
    const pdf = await renderPdf({ template: acroFormPdf(boxes(...Object.keys(own))), form: parts, data: filled, bindings: own, format })
    return { printed: await values(pdf), read: await extractPdfData({ pdf, form: parts, bindings: own, format }) }
  }

  it('prints parts as plain digits whatever the layer sets for money digits, grouping and case', async () => {
    const { printed } = await fill({ money: { fractionDigits: 0, useGrouping: false }, case: 'upper' })
    expect(printed).toMatchObject({ units: '1234', cents: '50', year: '2021', whole: '$1235' })
    expect((await fill({ money: { fractionDigits: 2, useGrouping: true } })).printed).toMatchObject({ units: '1234', cents: '50', whole: '$1,234.50' })
  })

  it('prints parts as plain digits under a binding that sets money digits and case', async () => {
    const own: Bindings = {
      units: { path: 'amount', part: 'units', format: { money: { fractionDigits: 0, useGrouping: true }, case: 'upper' } },
      cents: { path: 'amount', part: 'cents', format: { money: { fractionDigits: 0 } } },
    }
    expect((await fill({}, own)).printed).toEqual({ units: '1234', cents: '50' })
  })

  it('reads the parts back into the exact amount', async () => {
    const { read } = await fill({ money: { fractionDigits: 0, useGrouping: false }, case: 'upper' }, { units: bindings.units!, cents: bindings.cents! })
    expect(read.data.fields).toEqual({ amount: { amount: 1234.5, currency: 'USD' } })
    expect(read.report.entries[0]).toMatchObject({ status: 'recovered', lossy: false })
  })

  it('prints a part placeholder as plain digits under the layer\'s money digits and case', () => {
    const printed = renderText({ template: '{{ fields.amount | part="units" }}.{{ fields.amount | part="cents" }} {{ fields.dob | part="year", case="upper" }}', form: parts, data: filled, format: { money: { fractionDigits: 0, useGrouping: false }, case: 'upper' } })
    expect(printed).toBe('1234.50 2021')
  })
})
