import { unzipSync, zipSync } from 'fflate'
import { createFormatter } from '@asterdoc/format'
import { createTypeEnv, T } from '@asterdoc/expr'
import type { Form } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { checkTextTemplate, formValueResolver, renderText, TemplateError } from '../src/text'
import { checkDocxTemplate, renderDocx } from '../src/docx'

const form = {
  kind: 'form',
  name: 'phone-choice-boolean-modifiers',
  fields: {
    us: { type: 'phone', label: 'US' },
    uk: { type: 'phone', label: 'UK' },
    status: { type: 'enum', label: 'Status', enum: [{ value: 'S', label: 'Single' }, { value: 'M', label: 'Married' }] },
    colors: { type: 'multiselect', label: 'Colors', enum: [{ value: 'r', label: 'Red' }, { value: 'b', label: 'Blue' }] },
    wed: { type: 'boolean', label: 'Wed' },
    qty: { type: 'number', label: 'Quantity' },
    note: { type: 'text', label: 'Note' },
    people: { type: 'list', label: 'People', item: { type: 'fieldset', label: 'Person', fields: { phone: { type: 'phone', label: 'Phone' }, adult: { type: 'boolean', label: 'Adult' } } } },
  },
  defs: { married: { type: 'boolean', value: 'fields.wed' } },
} as unknown as Form

const data = {
  us: { number: '+12125551234' },
  uk: { number: '+442079460958', extension: '42' },
  status: 'M',
  colors: ['r', 'b'],
  wed: true,
  qty: 3,
  note: 'n',
  people: [{ phone: '+6565123456', adult: false }],
  defs: { married: true },
}

const env = createTypeEnv({
  fields: T.object,
  'fields.us': T.object,
  'fields.uk': T.object,
  'fields.status': T.string,
  'fields.colors': T.array(T.string),
  'fields.wed': T.boolean,
  'fields.qty': T.number,
  'fields.note': T.string,
  'fields.people': T.array(T.object),
  'fields.people.phone': T.object,
  'fields.people.adult': T.boolean,
  married: T.boolean,
})
const values = formValueResolver(form)

const render = (template: string, options: Partial<Parameters<typeof renderText>[0]> = {}) => renderText({ form, data, template, ...options })
const check = (template: string) => checkTextTemplate(template, env, { values })

describe('phone, choice and boolean modifiers on template placeholders', () => {
  it('print a phone in the style a modifier names, with the extension, and in the region it names', () => {
    expect(render('{{ fields.us | phone.style="international" }}|{{ fields.us | phone.style="national" }}|{{ fields.uk | phone.style="digits" }}'))
      .toBe('+1 212 555 1234|(212) 555-1234|2079460958 ext. 42')
    expect(render('{{ fields.us | phone.style="digits", phone.region="US" }}')).toBe('2125551234')
    expect(render('{{ fields.us }}')).toBe('+12125551234')
    expect(check('{{ fields.us | phone.style="national", phone.region="US" }}')).toEqual([])
  })

  it('refuse at render a national number of another plan than phone.region names', () => {
    expect(() => render('{{ fields.uk | phone.style="national", phone.region="US" }}')).toThrowError(/calling code \+44/)
  })

  it('fail with missing_format_provider when the caller formatter has no phone provider', () => {
    expect(() => render('{{ fields.us | phone.style="national" }}', { formatter: createFormatter() })).toThrowError(/@asterdoc\/format\/phone/)
  })

  it('print choices as values or labels under choice.display', () => {
    expect(render('{{ fields.status | choice.display="value" }}|{{ fields.colors | choice.display="value" }}')).toBe('M|r, b')
    expect(render('{{ fields.status | choice.display="label" }}', { format: { choice: { display: 'value' } } })).toBe('Married')
    expect(render('{{ fields.status }}')).toBe('Married')
  })

  it('print booleans of fields, list rows, definitions and computed expressions with the labels the modifiers name', () => {
    expect(render('{{ fields.wed | boolean.trueLabel="X", boolean.falseLabel="" }}|{{ married | boolean.trueLabel="Oui" }}|{{ fields.qty > 5 | boolean.falseLabel="Few" }}'))
      .toBe('X|Oui|Few')
    expect(render('{{#each fields.people}}{{ item.adult | boolean.falseLabel="Minor" }} {{ item.phone | phone.style="national" }}{{/each}}')).toBe('Minor 6512 3456')
    expect(render('{{ fields.wed | boolean.trueLabel="Y" }}', { format: { boolean: { trueLabel: 'Yes!', falseLabel: 'No!' } } })).toBe('Y')
  })

  it('refuse wrong values at check and at render', () => {
    const cases: Array<[string, RegExp]> = [
      ['{{ fields.us | phone.style="local" }}', /phone\.style takes "e164", "international", "national", "digits", not "local"/],
      ['{{ fields.us | phone.region="XX" }}', /phone\.region takes the ISO 3166-1 alpha-2 code of a numbering plan/],
      ['{{ fields.us | phone.region="us" }}', /not "us"/],
      ['{{ fields.status | choice.display="code" }}', /choice\.display takes "label", "value"/],
      ['{{ fields.wed | boolean.trueLabel=true }}', /boolean\.trueLabel takes a string/],
      [`{{ fields.wed | boolean.falseLabel="${'x'.repeat(201)}" }}`, /at most 200 characters/],
    ]
    for (const [template, message] of cases) {
      expect(check(template), template).toEqual([expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(message) })])
      expect(() => render(template), template).toThrowError(TemplateError)
    }
  })

  it('refuse keys that do not apply to the value\'s kind at check and at render', () => {
    const cases: Array<[string, RegExp]> = [
      ['{{ fields.note | phone.style="national" }}', /phone\.style applies to phone numbers, not to fields\.note, a text value/],
      ['{{ fields.status | phone.region="US" }}', /phone\.region applies to phone numbers/],
      ['{{ fields.wed | choice.display="label" }}', /choice\.display applies to enum and multiselect values, not to fields\.wed, a boolean value/],
      ['{{ fields.status | boolean.trueLabel="Y" }}', /boolean\.trueLabel applies to booleans, not to fields\.status/],
      ['{{ fields.us | boolean.falseLabel="N" }}', /boolean\.falseLabel applies to booleans/],
      ['{{ "M" | choice.display="label" }}', /choice\.display applies to enum and multiselect values, not to a string value/],
    ]
    for (const [template, message] of cases) {
      expect(check(template), template).toEqual([expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(message) })])
      expect(() => render(template), template).toThrowError(TemplateError)
    }
  })
})

describe('phone, choice and boolean modifiers in Word templates', () => {
  const encoder = new TextEncoder()
  const docx = (text: string) => zipSync({
    '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': encoder.encode(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`),
  })
  const visible = (bytes: Uint8Array) => [...new TextDecoder().decode(unzipSync(bytes)['word/document.xml']).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join('')

  it('read the keys with curly quotes, at check and at render', async () => {
    const template = '{{ fields.us | phone.style=“national” }} {{ fields.status | choice.display=“value” }} {{ fields.wed | boolean.trueLabel=“Ja” }}'
    expect(await checkDocxTemplate(docx(template), env, { values })).toEqual([])
    expect(visible(await renderDocx({ template: docx(template), form, data }))).toBe('(212) 555-1234 M Ja')
  })
})
