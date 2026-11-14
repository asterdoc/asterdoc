import type { Bindings, Form, LayerFormat } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { joinedBindingTemplate } from '../src/index'
import { extractPdfData, inspectAcroFormFields, PdfBindingSyntaxError, renderPdf } from '../src/pdf'
import { TemplateError } from '../src/text'
import { acroFormPdf, type AcroFormFixtureField } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'templates',
  version: '1.0.0',
  title: 'Templates',
  fields: {
    name: { type: 'text', label: 'Name' },
    nickname: { type: 'text', label: 'Nickname' },
    ssn: { type: 'text', label: 'SSN', mask: '###-##-####' },
    mailing: { type: 'address', label: 'Mailing address' },
    llc: { type: 'enum', label: 'LLC type', enum: [{ value: 'C', label: 'C corporation' }, { value: 'S', label: 'S corporation' }, { value: 'P', label: 'Partnership' }] },
    born: { type: 'date', label: 'Born' },
    fee: { type: 'money', label: 'Fee', currency: 'USD' },
    exempt: { type: 'boolean', label: 'Exempt' },
    count: { type: 'number', label: 'Count' },
    email: { type: 'email', label: 'Email' },
    owners: { type: 'list', label: 'Owners', item: { type: 'fieldset', label: 'Owner', fields: { name: { type: 'text', label: 'Name' }, born: { type: 'date', label: 'Born' } } } },
  },
  defs: { total: { type: 'money', value: {} } },
  parties: { requester: { label: 'Requester', partyType: 'organization' } },
} as unknown as Form

const data = {
  fields: {
    name: 'Harbor Ledger',
    ssn: '123456789',
    mailing: { line1: '2150 Market Street', line2: 'Suite 300', locality: 'Boston', region: 'MA', postalCode: '02110', country: 'US' },
    llc: 'P',
    born: '1990-03-05',
    fee: { amount: 1234.5, currency: 'USD' },
    exempt: false,
    count: 3,
    email: 'ops@harbor.example',
    owners: [{ name: 'Ann', born: '1980-01-02' }, { name: 'Bo', born: '1985-06-07' }],
  },
  defs: { total: { amount: 99, currency: 'USD' } },
  parties: { requester: { name: 'Pearl Bank' } },
}

type Values = typeof data.fields

const withFields = (fields: Partial<Record<keyof Values, unknown>>) => ({ ...data, fields: { ...data.fields, ...fields } })
const without = (...names: (keyof Values)[]) => ({ ...data, fields: Object.fromEntries(Object.entries(data.fields).filter(([name]) => !names.includes(name as keyof Values))) })

const box: AcroFormFixtureField[] = [{ kind: 'text', name: 'box' }]

async function values(pdf: Uint8Array): Promise<Record<string, unknown>> {
  return Object.fromEntries((await inspectAcroFormFields(pdf, { includeButton: true })).map((field) => [field.name, field.value]))
}

async function print(template: string, options: { data?: Record<string, unknown>; format?: LayerFormat; binding?: LayerFormat; form?: Form | null } = {}): Promise<unknown> {
  const pdf = await renderPdf({
    template: acroFormPdf(box),
    ...(options.form !== null && { form: options.form ?? form }),
    data: options.data ?? data,
    bindings: { box: { template, ...(options.binding && { format: options.binding }) } },
    ...(options.format && { format: options.format }),
  })
  return (await values(pdf)).box
}

const CITY_LINE = '{{fields.mailing.locality}}, {{fields.mailing.region}} {{fields.mailing.postalCode}}'
const STREET_LINE = '{{fields.mailing.line1}}{{#if fields.mailing.line2 != null}}, {{fields.mailing.line2}}{{/if}}'

describe('filling a template binding', () => {
  it('prints each value with the template\'s own text between them', async () => {
    expect(await print(CITY_LINE)).toBe('Boston, MA 02110')
    expect(await print('{{fields.name}} ({{parties.requester.name}})')).toBe('Harbor Ledger (Pearl Bank)')
  })

  it('prints a block only when its condition holds', async () => {
    expect(await print(STREET_LINE)).toBe('2150 Market Street, Suite 300')
    const noUnit = withFields({ mailing: { ...data.fields.mailing, line2: undefined } })
    expect(await print(STREET_LINE, { data: noUnit })).toBe('2150 Market Street')
    expect(await print('{{#unless fields.exempt}}Not exempt{{else}}Exempt{{/unless}}: {{fields.name}}')).toBe('Not exempt: Harbor Ledger')
    expect(await print('{{#if fields.llc == "P"}}Partnership of {{fields.count}}{{else}}{{fields.llc}}{{/if}}')).toBe('Partnership of 3')
  })

  it('keeps a line break of the template in the value', async () => {
    expect(await print(`{{fields.name}}\n${STREET_LINE}\n${CITY_LINE}`)).toBe('Harbor Ledger\n2150 Market Street, Suite 300\nBoston, MA 02110')
  })

  it('reads a list row by its index and a computed value by its name', async () => {
    expect(await print('{{fields.owners[1].name}}, born {{fields.owners[1].born}}; total {{total}}')).toBe(`Bo, born ${await print('{{fields.owners[1].born}}')}; total $99.00`)
  })

  it('prints a computed expression', async () => {
    expect(await print('{{upper(fields.name)}} x{{fields.count + 1}}')).toBe('HARBOR LEDGER x4')
    expect(await print('{{coalesce(fields.nickname, fields.name)}}')).toBe('Harbor Ledger')
  })

  it('prints a choice as its option value, and as its label when a format says so', async () => {
    expect(await print('LLC: {{fields.llc}}')).toBe('LLC: P')
    expect(await print('LLC: {{fields.llc}}', { binding: { choice: { display: 'label' } } })).toBe('LLC: Partnership')
    expect(await print('LLC: {{fields.llc}}', { format: { choice: { display: 'label' } } })).toBe('LLC: Partnership')
    expect(await print('{{fields.llc}} = {{fields.llc | choice.display="label"}}')).toBe('P = Partnership')
    expect(await print('{{fields.llc | choice.display="value"}}', { format: { choice: { display: 'label' } } })).toBe('P')
  })

  it('prints each value as a path binding to the same path prints it', async () => {
    const paths = ['name', 'ssn', 'mailing.line1', 'mailing.region', 'mailing.country', 'llc', 'born', 'fee', 'fee.amount', 'exempt', 'count', 'email', 'owners[0].born', 'parties.requester', 'parties.requester.name', 'defs.total']
    const expression = (path: string) => path.startsWith('parties.') ? path : path.startsWith('defs.') ? path.slice('defs.'.length) : `fields.${path}`
    const names = paths.map((_, index) => `f${index}`)
    const fields: AcroFormFixtureField[] = names.map((name) => ({ kind: 'text', name }))
    const formats: (LayerFormat | undefined)[] = [
      undefined,
      { date: { pattern: 'DD/MM/YYYY' }, money: { currencyDisplay: 'none' } },
      { case: 'upper', locale: 'de-DE' },
      { region: { display: 'name' }, country: { display: 'name' }, choice: { display: 'label' }, boolean: { trueLabel: 'Y', falseLabel: 'N' } },
    ]
    for (const format of formats) {
      const asPaths: Bindings = Object.fromEntries(paths.map((path, index) => [names[index]!, path]))
      const asTemplates: Bindings = Object.fromEntries(paths.map((path, index) => [names[index]!, { template: `{{${expression(path)}}}` }]))
      const byPath = await values(await renderPdf({ template: acroFormPdf(fields), form, data, bindings: asPaths, ...(format && { format }) }))
      const byTemplate = await values(await renderPdf({ template: acroFormPdf(fields), form, data, bindings: asTemplates, ...(format && { format }) }))
      expect(byTemplate, JSON.stringify(format)).toEqual(byPath)
    }
  })

  it('applies the layer format, then the binding\'s, then a placeholder\'s own modifiers', async () => {
    const dates = '{{fields.born}} {{fields.owners[0].born | date.pattern="YYYY-MM-DD"}}'
    expect(await print(dates, { format: { date: { pattern: 'MM/DD/YYYY' } } })).toBe('03/05/1990 1980-01-02')
    expect(await print(dates, { format: { date: { pattern: 'MM/DD/YYYY' } }, binding: { date: { pattern: 'DD/MM/YYYY' } } })).toBe('05/03/1990 1980-01-02')
    expect(await print('{{fields.born | part="year"}}-{{fields.born | part="month"}}')).toBe('1990-03')
    expect(await print('{{fields.fee | money.currencyDisplay="none"}} of {{fields.fee}}')).toBe('1,234.50 of $1,234.50')
  })

  it('applies a binding\'s case to the whole field and a layer\'s case to the values', async () => {
    const template = 'c/o {{fields.name}} <{{fields.email}}>'
    expect(await print(template, { binding: { case: 'upper' } })).toBe('C/O HARBOR LEDGER <OPS@HARBOR.EXAMPLE>')
    expect(await print(template, { format: { case: 'upper' } })).toBe('c/o HARBOR LEDGER <ops@harbor.example>')
    expect(await print(template, { format: { case: 'upper' }, binding: { case: 'none' } })).toBe('c/o Harbor Ledger <ops@harbor.example>')
    expect(await print('{{fields.name | case="upper"}} / {{fields.name}}')).toBe('HARBOR LEDGER / Harbor Ledger')
  })

  it('prints a masked value through its mask', async () => {
    expect(await print('SSN {{fields.ssn}}')).toBe('SSN 123-45-6789')
  })

  it('leaves the field empty when every placeholder it reached printed nothing', async () => {
    expect(await print(CITY_LINE, { data: without('mailing') })).toBeUndefined()
    expect(await print('Attn: {{fields.nickname}}')).toBeUndefined()
    expect(await print('{{#if fields.nickname != null}}Attn: {{fields.nickname}}{{/if}}')).toBeUndefined()
    expect(await print('{{fields.name}}, {{fields.nickname}} {{fields.count}}', { data: without('count') })).toBe('Harbor Ledger,  ')
  })

  it('prints a template\'s own text when the branch taken holds no placeholder', async () => {
    expect(await print('{{#if fields.llc == "P"}}Partnership{{else}}{{fields.nickname}}{{/if}}')).toBe('Partnership')
    expect(await print('{{#if fields.llc == "C"}}Corporation{{else}}{{fields.nickname}}{{/if}}')).toBeUndefined()
    expect(await print('{{#if fields.llc == "C"}}Corporation{{/if}}')).toBeUndefined()
  })

  it('fills from values at the root of the data, and without a form', async () => {
    const flat = { ...data.fields, parties: data.parties }
    expect(await print(`${CITY_LINE} for {{parties.requester.name}}`, { data: flat })).toBe('Boston, MA 02110 for Pearl Bank')
    expect(await print('{{fields.name}}: {{fields.llc}}', { form: null })).toBe('Harbor Ledger: P')
  })

  it('fails on an expression that cannot run, naming the field', async () => {
    const error = await print('{{fields.name}} {{nope(fields.name)}}').then(() => undefined, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(TemplateError)
    expect((error as Error).message).toContain('Template error at binding "box", line 1, column 19 in {{nope(fields.name)}}')
  })

  it('fails on a condition that is not a yes or no', async () => {
    await expect(print('{{#if fields.name}}x{{/if}}')).rejects.toThrow('A condition must be boolean')
  })

  it('refuses a template with a loop or a signing directive before it fills anything', async () => {
    await expect(print('{{#each fields.owners}}{{item.name}}{{/each}}')).rejects.toThrow(PdfBindingSyntaxError)
    await expect(print('{{signature(parties.requester, "sign")}}')).rejects.toThrow(PdfBindingSyntaxError)
  })

  it('fills only as many list rows as its placeholders name', async () => {
    const flat = { ...data.fields, parties: data.parties }
    await expect(print('{{fields.owners[0].name}}', { data: flat })).rejects.toThrow('PDF bindings for "owners" support 1 list items, but received 2')
    expect(await print('{{fields.owners[0].name}} and {{fields.owners[1].name}}', { data: flat })).toBe('Ann and Bo')
  })
})

describe('the template a comma-joined binding becomes', () => {
  const joinedForm = { kind: 'form', name: 'joined', version: '1.0.0', title: 'Joined', fields: { a: { type: 'text' }, b: { type: 'text' }, c: { type: 'text' }, home: { type: 'address' } } } as unknown as Form

  it('names each path from its root, a list row by its index', () => {
    expect(joinedBindingTemplate('a, fields.b')).toBe('{{fields.a}}{{#if isNotEmpty(fields.b)}}{{#if isNotEmpty(fields.a)}}, {{/if}}{{fields.b}}{{/if}}')
    expect(joinedBindingTemplate('parties.payer.name,lines.0.amount,defs.total')).toContain('{{#if isNotEmpty(total)}}{{#if isNotEmpty(parties.payer.name) or isNotEmpty(fields.lines[0].amount)}}, {{/if}}{{total}}{{/if}}')
  })

  it('prints the values that are not empty with ", " between them, as the join did', async () => {
    const template = joinedBindingTemplate('a, b, c')
    for (const a of ['', 'A', null, undefined]) {
      for (const b of ['', 'B', null]) {
        for (const c of ['', 'C', undefined]) {
          const fields = Object.fromEntries(Object.entries({ a, b, c }).filter(([, value]) => value !== undefined))
          const pdf = await renderPdf({ template: acroFormPdf(box), form: joinedForm, data: { fields }, bindings: { box: { template } } })
          const joined = [a, b, c].filter((value) => value !== null && value !== undefined && value !== '').join(', ')
          expect((await values(pdf)).box, JSON.stringify(fields)).toBe(joined === '' ? undefined : joined)
        }
      }
    }
  })

  it('prints address members as the join did', async () => {
    const template = joinedBindingTemplate('home.line1,home.line2,home.locality,home.region,home.postalCode')
    const home = { line1: '1 Main St', locality: 'Springfield', region: 'IL', postalCode: '62701', country: 'US' }
    const pdf = await renderPdf({ template: acroFormPdf(box), form: joinedForm, data: { fields: { home } }, bindings: { box: { template } } })
    expect((await values(pdf)).box).toBe('1 Main St, Springfield, IL, 62701')
  })

  it('refuses a join it cannot read', () => {
    expect(() => joinedBindingTemplate('a,,c')).toThrow(PdfBindingSyntaxError)
    expect(() => joinedBindingTemplate('ssn:1, ssn:2')).toThrow('qualifies a part of a joined binding')
  })
})

describe('reading a template field back', () => {
  const fields: AcroFormFixtureField[] = [{ kind: 'text', name: 'box' }, { kind: 'text', name: 'other' }]

  async function roundTrip(binding: Bindings[string], values: Record<string, unknown> = data, format?: LayerFormat, other: Bindings[string] = 'count') {
    const bindings: Bindings = { box: binding, other }
    const pdf = await renderPdf({ template: acroFormPdf(fields), form, data: values, bindings, ...(format && { format }) })
    return extractPdfData({ pdf, form, bindings, ...(format && { format }) })
  }

  async function read(binding: Bindings[string], text: string | undefined, format?: LayerFormat) {
    const pdf = acroFormPdf([{ kind: 'text', name: 'box', ...(text !== undefined && { value: text }) }])
    return extractPdfData({ pdf, form, bindings: { box: binding }, ...(format && { format }) })
  }

  const entry = (result: Awaited<ReturnType<typeof extractPdfData>>, path: string) => result.report.entries.find((item) => item.path === path)

  it('splits the text into its values when it splits one way', async () => {
    const result = await roundTrip({ template: CITY_LINE })
    expect(result.data.fields).toEqual({ mailing: { locality: 'Boston', region: 'MA', postalCode: '02110' }, count: 3 })
    expect(entry(result, 'mailing.region')).toEqual({ path: 'mailing.region', status: 'recovered', sources: [{ field: 'box', value: 'Boston, MA 02110' }], lossy: false })
  })

  it('reads a block the text does not hold as empty values', async () => {
    const noUnit = withFields({ mailing: { ...data.fields.mailing, line2: undefined } })
    const result = await roundTrip({ template: STREET_LINE }, noUnit)
    expect(result.data.fields).toEqual({ mailing: { line1: '2150 Market Street' }, count: 3 })
    expect(entry(result, 'mailing.line2')).toEqual({ path: 'mailing.line2', status: 'empty', sources: [{ field: 'box', value: '2150 Market Street' }] })
  })

  it('does not guess when the text splits in more than one way', async () => {
    const result = await roundTrip({ template: STREET_LINE })
    for (const path of ['mailing.line1', 'mailing.line2']) {
      expect(entry(result, path)).toEqual({
        path,
        status: 'not_recoverable',
        sources: [{ field: 'box', value: '2150 Market Street, Suite 300' }],
        reason: 'The field\'s text splits into the template\'s values in more than one way, and extraction does not guess.',
      })
    }
    expect(result.data.fields).toEqual({ count: 3 })
    const canadian = await read({ template: CITY_LINE }, 'Toronto, ON M5V 2T6')
    expect(entry(canadian, 'mailing.postalCode')).toMatchObject({ status: 'not_recoverable' })
  })

  it('splits on a line break of the template', async () => {
    const result = await roundTrip({ template: `{{fields.name}}\n${CITY_LINE}` })
    expect(result.data.fields).toEqual({ name: 'Harbor Ledger', mailing: { locality: 'Boston', region: 'MA', postalCode: '02110' }, count: 3 })
    const typed = await read({ template: '{{fields.name}}\n{{fields.nickname}}' }, 'Harbor Ledger\r\nHarbor')
    expect(typed.data.fields).toEqual({ name: 'Harbor Ledger', nickname: 'Harbor' })
  })

  it('reads each value by its own type and format', async () => {
    const binding = { template: '{{fields.born}} | {{fields.fee}} | {{fields.llc | choice.display="label"}} | {{fields.exempt}}', format: { date: { pattern: 'DD/MM/YYYY' as const }, boolean: { trueLabel: 'Y', falseLabel: 'N' } } }
    const result = await roundTrip(binding)
    expect(result.data.fields).toEqual({ born: '1990-03-05', fee: { amount: 1234.5, currency: 'USD' }, llc: 'P', exempt: false, count: 3 })
  })

  it('reads a value from its parts', async () => {
    const result = await roundTrip({ template: '{{fields.born | part="month"}}/{{fields.born | part="day"}}/{{fields.born | part="year"}}' })
    expect(result.data.fields).toEqual({ born: '1990-03-05', count: 3 })
  })

  it('reads a masked value through its mask and a choice by its option value', async () => {
    const result = await roundTrip({ template: '{{fields.ssn}} ({{fields.llc}})' })
    expect(result.data.fields).toEqual({ ssn: '123456789', llc: 'P', count: 3 })
  })

  it('matches the template\'s own text in the case the binding printed it', async () => {
    const result = await roundTrip({ template: 'c/o {{fields.name}} at {{fields.llc}}', format: { case: 'upper' } })
    expect(result.data.fields).toEqual({ name: 'HARBOR LEDGER', llc: 'P', count: 3 })
    expect(entry(result, 'name')).toMatchObject({ status: 'recovered', lossy: true })
  })

  it('reports text that does not match the template as unparseable', async () => {
    const result = await read({ template: CITY_LINE }, 'Boston MA 02110')
    for (const path of ['mailing.locality', 'mailing.region', 'mailing.postalCode']) {
      expect(entry(result, path)).toEqual({
        path,
        status: 'unparseable',
        sources: [{ field: 'box', value: 'Boston MA 02110' }],
        reason: 'The field\'s text does not match the binding\'s template.',
      })
    }
  })

  it('reports a value whose text does not parse, and still reads the others', async () => {
    const result = await read({ template: '{{fields.name}} born {{fields.born}}' }, 'Harbor Ledger born sometime')
    expect(result.data.fields).toEqual({ name: 'Harbor Ledger' })
    expect(entry(result, 'born')).toMatchObject({ status: 'unparseable', sources: [{ field: 'box', value: 'Harbor Ledger born sometime' }] })
  })

  it('does not read back a template that prints a computed value', async () => {
    const result = await roundTrip({ template: '{{fields.name}} x{{fields.count + 1}}' }, data, undefined, 'email')
    for (const path of ['name', 'count']) {
      expect(entry(result, path)).toMatchObject({ status: 'not_recoverable', reason: 'The template prints a computed value, which cannot be read back.' })
    }
    expect(result.data.fields).toEqual({ email: 'ops@harbor.example' })
  })

  it('reads an empty field as empty values', async () => {
    const result = await read({ template: CITY_LINE }, undefined)
    expect(result.data.fields).toEqual({})
    expect(entry(result, 'mailing.locality')).toEqual({ path: 'mailing.locality', status: 'empty', sources: [{ field: 'box' }] })
  })

  it('reports a value two fields disagree on', async () => {
    const pdf = acroFormPdf([{ kind: 'text', name: 'box', value: 'Boston, MA 02110' }, { kind: 'text', name: 'other', value: 'NY' }])
    const result = await extractPdfData({ pdf, form, bindings: { box: { template: CITY_LINE }, other: 'mailing.region' } })
    expect(entry(result, 'mailing.region')).toMatchObject({ status: 'unparseable', reason: 'The PDF fields that carry this path hold different values.' })
    expect(result.data.fields).toEqual({ mailing: { locality: 'Boston', postalCode: '02110' } })
  })
})
