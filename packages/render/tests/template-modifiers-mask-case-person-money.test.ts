import { unzipSync, zipSync } from 'fflate'
import { createTypeEnv, T } from '@asterdoc/expr'
import type { Form } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { checkTextTemplate, formValueResolver, renderText, TemplateError } from '../src/text'
import { renderDocx } from '../src/docx'

const form = {
  kind: 'form',
  name: 'modifiers',
  fields: {
    ssn: { type: 'text', label: 'SSN', mask: '###-##-####' },
    note: { type: 'text', label: 'Note' },
    email: { type: 'email', label: 'Email' },
    price: { type: 'money', label: 'Price' },
    client: { type: 'person', label: 'Client' },
    home: { type: 'address', label: 'Home' },
    approved: { type: 'boolean', label: 'Approved' },
    lines: { type: 'list', label: 'Lines', item: { type: 'fieldset', label: 'Line', fields: { ein: { type: 'text', label: 'EIN', mask: '##-#######' } } } },
  },
  defs: { total: { type: 'money', value: 'fields.price' } },
  parties: { tenant: { label: 'Tenant', partyType: 'person' } },
} as unknown as Form

const data = {
  ssn: '123456789',
  note: 'istanbul',
  email: 'ada@example.com',
  price: { amount: 1234567.5, currency: 'USD' },
  client: { name: 'Ada K. Lovelace', firstName: 'Ada', middleName: 'K.', lastName: 'Lovelace' },
  home: { line1: '1 Main St', locality: 'Ottawa', region: 'ON', postalCode: 'K1A 0B1', country: 'CA' },
  approved: true,
  lines: [{ ein: '123456789' }],
  defs: { total: { amount: 1234567.5, currency: 'USD' } },
  parties: { tenant: { id: 'tenant-0', name: 'Bo Tenant', firstName: 'Bo', lastName: 'Tenant' } },
}

const env = createTypeEnv({
  fields: T.object,
  'fields.ssn': T.string,
  'fields.note': T.string,
  'fields.email': T.string,
  'fields.price': T.money,
  'fields.client': T.object,
  'fields.home': T.object,
  'fields.home.locality': T.string,
  'fields.approved': T.boolean,
  'fields.lines': T.array(T.object),
  'fields.lines.ein': T.string,
  total: T.money,
  parties: T.object,
  'parties.tenant': T.object,
})
const values = formValueResolver(form)

const render = (template: string, options: Partial<Parameters<typeof renderText>[0]> = {}) => renderText({ form, data, template, ...options })
const check = (template: string) => checkTextTemplate(template, env, { values })
const refused = (template: string) => {
  try {
    render(template)
  } catch (error) {
    return error instanceof TemplateError ? error.message : String(error)
  }
  return undefined
}

describe('mask, case, person and money modifiers', () => {
  it('prints a masked field with its mask, without it, or with another', () => {
    expect(render('{{ fields.ssn }}|{{ fields.ssn | text.mask=false }}|{{ fields.ssn | text.mask="### ## ####" }}|{{ fields.ssn | text.mask=true }}'))
      .toBe('123-45-6789|123456789|123 45 6789|123-45-6789')
    expect(render('{{#each fields.lines}}{{ item.ein | text.mask=false }} {{ item.ein }}{{/each}}')).toBe('123456789 12-3456789')
    expect(render('{{ fields.note | text.mask="@@@@-@@@@" }}')).toBe('ista-nbul')
  })

  it('refuses text.mask without the field metadata it needs, at check and at render', () => {
    for (const [template, message] of [
      ['{{ fields.note | text.mask=true }}', 'fields.note has none'],
      ['{{ fields.email | text.mask=false }}', 'applies to a declared text field'],
      ['{{ fields.home.locality | text.mask=false }}', 'applies to a declared text field'],
      ['{{ "abc" | text.mask=false }}', 'applies to a declared text field'],
      ['{{ fields.ssn | text.mask="A-B" }}', 'text.mask takes true, false or a mask'],
    ] as const) {
      expect(check(template).map((issue) => issue.message).join(' '), template).toContain(message)
      expect(refused(template), template).toContain(message)
    }
  })

  it('upper-cases any value under case, after other modifiers, and none turns a layer upper off', () => {
    expect(render('{{ fields.note | case="upper" }}|{{ fields.email | case="upper" }}|{{ fields.home.locality | case="upper" }}|{{ "abc" | case="upper" }}'))
      .toBe('ISTANBUL|ADA@EXAMPLE.COM|OTTAWA|ABC')
    expect(render('{{ fields.note | case="upper", locale="tr-TR" }}')).toBe('İSTANBUL')
    expect(render('{{ fields.client | person.order="family-first", case="upper" }}')).toBe('LOVELACE, ADA K.')
    expect(render('{{ fields.note }}|{{ fields.note | case="none" }}|{{ fields.email }}', { format: { case: 'upper' } })).toBe('ISTANBUL|istanbul|ada@example.com')
    expect(check('{{ fields.note | case="lower" }}').map((issue) => issue.message).join(' ')).toContain('case takes "upper", "none"')
  })

  it('orders person fields and person parties, and refuses other kinds', () => {
    expect(render('{{ fields.client | person.order="family-first" }}|{{ parties.tenant | person.order="family-first" }}|{{ fields.client }}'))
      .toBe('Lovelace, Ada K.|Tenant, Bo|Ada K. Lovelace')
    expect(refused('{{ fields.note | person.order="family-first" }}')).toContain('person.order applies to people and parties')
    expect(check('{{ fields.client | person.order="surname" }}')).not.toEqual([])
  })

  it('rounds money to whole units and drops grouping, on fields and computed values', () => {
    expect(render('{{ fields.price | money.fractionDigits=0 }}|{{ fields.price | money.useGrouping=false }}|{{ total | money.fractionDigits=0, money.useGrouping=false }}'))
      .toBe('$1,234,568|$1234567.50|$1234568')
    expect(refused('{{ fields.note | money.fractionDigits=0 }}')).toContain('applies to money values')
    expect(check('{{ fields.price | money.fractionDigits=1 }}').map((issue) => issue.message).join(' ')).toContain('takes 0 or 2')
    expect(check('{{ fields.price | money.useGrouping="no" }}').map((issue) => issue.message).join(' ')).toContain('takes true or false')
    expect(check('{{ fields.price | money.fractionDigits=2, money.useGrouping=true }}')).toEqual([])
  })

  it('applies in Word templates', async () => {
    const encoder = new TextEncoder()
    const template = zipSync({
      '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': encoder.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': encoder.encode('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">{{ fields.ssn | text.mask=false }} {{ fields.client | person.order=“family-first”, case=“upper” }}</w:t></w:r></w:p></w:body></w:document>'),
    })
    const bytes = await renderDocx({ template, form, data })
    const xml = new TextDecoder().decode(unzipSync(bytes)['word/document.xml'])
    expect(xml).toContain('123456789 LOVELACE, ADA K.')
  })
})
