import { unzipSync, zipSync } from 'fflate'
import { createTypeEnv, T } from '@asterdoc/expr'
import type { Form } from '@asterdoc/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkTextTemplate, formValueResolver, renderText, TemplateError } from '../src/text'
import { checkDocxTemplate, renderDocx } from '../src/docx'
import { FORMAT_MODIFIER_RULES } from '../src/template/format-modifiers'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const form = {
  kind: 'form',
  name: 'modifiers',
  fields: {
    due: { type: 'date', label: 'Due' },
    price: { type: 'money', label: 'Price' },
    qty: { type: 'number', label: 'Quantity' },
    note: { type: 'text', label: 'Note' },
    approved: { type: 'boolean', label: 'Approved' },
    home: { type: 'address', label: 'Home' },
    id: { type: 'identification', label: 'ID' },
    dates: { type: 'list', label: 'Dates', item: { type: 'date', label: 'Date' } },
    lines: {
      type: 'list',
      label: 'Lines',
      item: {
        type: 'fieldset',
        label: 'Line',
        fields: {
          name: { type: 'text', label: 'Name' },
          when: { type: 'date', label: 'When' },
          cost: { type: 'money', label: 'Cost' },
          dates: { type: 'list', label: 'Dates', item: { type: 'date', label: 'Date' } },
        },
      },
    },
  },
  defs: {
    total: { type: 'money', value: 'fields.price' },
    deadline: { type: 'date', value: 'fields.due' },
  },
  parties: {
    tenant: { label: 'Tenant', partyType: 'person' },
    witnesses: { label: 'Witnesses', max: 2 },
  },
  annexes: { lease: { title: 'Lease' } },
} as unknown as Form

const data = {
  due: '2024-03-05',
  price: { amount: 1234.5, currency: 'USD' },
  qty: 1234.5,
  note: 'A & <B>',
  approved: true,
  home: { line1: '1 Main St', locality: 'Ottawa', region: 'ON', postalCode: 'K1A 0B1', country: 'CA' },
  id: { type: 'passport', number: 'X1', issueDate: '2020-01-31' },
  dates: ['2024-07-08', '2024-09-10'],
  lines: [
    { name: 'Bolt', when: '2024-01-02', cost: { amount: 5, currency: 'USD' }, dates: ['2024-07-08', '2024-09-10'] },
    { name: 'Nut', when: '2024-11-12', cost: { amount: 7, currency: 'USD' }, dates: [] },
  ],
  defs: { total: { amount: 1234.5, currency: 'USD' }, deadline: '2024-03-05' },
  parties: {
    tenant: { id: 'tenant-0', firstName: 'Ada', lastName: 'Lovelace' },
    witnesses: [{ id: 'witnesses-0', name: 'Bo' }],
  },
  annexes: { lease: { name: 'lease.pdf', mimeType: 'application/pdf' } },
}

const env = createTypeEnv({
  fields: T.object,
  'fields.due': T.date,
  'fields.price': T.money,
  'fields.price.amount': T.number,
  'fields.price.currency': T.string,
  'fields.qty': T.number,
  'fields.note': T.string,
  'fields.approved': T.boolean,
  'fields.home': T.object,
  'fields.home.country': T.string,
  'fields.home.region': T.string,
  'fields.id': T.object,
  'fields.id.issueDate': T.date,
  'fields.dates': T.array(T.date),
  'fields.lines': T.array(T.object),
  'fields.lines.name': T.string,
  'fields.lines.when': T.date,
  'fields.lines.cost': T.money,
  'fields.lines.dates': T.array(T.date),
  total: T.money,
  deadline: T.date,
  parties: T.object,
  'parties.tenant': T.object,
  'parties.witnesses': T.array(T.object),
  'parties.witnesses.name': T.string,
  annexes: T.object,
  'annexes.lease': T.object,
})
const values = formValueResolver(form)

const render = (template: string, options: Partial<Parameters<typeof renderText>[0]> = {}) =>
  renderText({ form, data, template, ...options })

const check = (template: string) => checkTextTemplate(template, env, { values })

function docx(parts: Record<string, string[]>, wrap = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': encoder.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  }
  for (const [part, paragraphs] of Object.entries(parts)) {
    const root = part === 'word/document.xml' ? 'w:document' : part.includes('header') ? 'w:hdr' : 'w:ftr'
    const body = paragraphs.map(wrap).join('')
    const content = root === 'w:document' ? `<w:body>${body}</w:body>` : body
    files[part] = encoder.encode(`<?xml version="1.0"?><${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${content}</${root}>`)
  }
  return zipSync(files)
}

const runs = (...texts: string[]) => `<w:p>${texts.map((text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`).join('')}</w:p>`

function partXml(bytes: Uint8Array, part = 'word/document.xml'): string {
  return decoder.decode(unzipSync(bytes)[part])
}

function wordText(bytes: Uint8Array, part = 'word/document.xml'): string {
  return [...partXml(bytes, part).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join('')
}

describe('format modifiers on template placeholders', () => {
  it('prints a date field in the pattern a modifier names, and as before without one', () => {
    expect(render('{{ fields.due | date.pattern="MM/DD/YYYY" }}|{{ fields.due | date.pattern="DD/MM/YYYY" }}|{{ fields.due | date.pattern="YYYY-MM-DD" }}'))
      .toBe('03/05/2024|05/03/2024|2024-03-05')
    expect(render('{{ fields.due }}')).toBe('Mar 5, 2024')
  })

  it('prints money without its currency symbol under money.currencyDisplay', () => {
    expect(render('{{ fields.price | money.currencyDisplay="none" }} / {{ fields.price }}')).toBe('1,234.50 / $1,234.50')
  })

  it('formats in the locale a modifier names', () => {
    expect(render('{{ fields.qty | locale="de-DE" }} {{ fields.due | locale="de-DE" }}')).toBe(`${(1234.5).toLocaleString('de-DE')} ${render('{{ fields.due }}', { formatter: undefined, format: { locale: 'de-DE' } })}`)
    expect(render('{{ fields.qty }}')).toBe('1,234.5')
  })

  it('merges the caller, the layer format, and the modifiers, per property', () => {
    const layer = { date: { pattern: 'DD/MM/YYYY' as const }, money: { currencyDisplay: 'none' as const }, locale: 'de-DE' }
    expect(render('{{ fields.due }} {{ fields.due | date.pattern="MM/DD/YYYY" }} {{ fields.price | locale="en-US" }}', { format: layer }))
      .toBe('05/03/2024 03/05/2024 1,234.50')
  })

  it('formats list item and fieldset members inside #each, at literal indexes, and in nested loops', () => {
    expect(render('{{#each fields.lines}}{{ item.when | date.pattern="MM/DD/YYYY" }};{{/each}}')).toBe('01/02/2024;11/12/2024;')
    expect(render('{{ fields.lines[1].when | date.pattern="YYYY-MM-DD" }} {{ fields.lines[0].cost | money.currencyDisplay="none" }}')).toBe('2024-11-12 5.00')
    expect(render('{{#each fields.lines}}{{#each item.dates}}{{ item | date.pattern="DD/MM/YYYY" }} ({{ parent.name }}) {{/each}}{{/each}}'))
      .toBe('08/07/2024 (Bolt) 10/09/2024 (Bolt) ')
  })

  it('formats computed values by their definition type', () => {
    expect(render('{{ total | money.currencyDisplay="none" }} {{ deadline | date.pattern="MM/DD/YYYY" }}')).toBe('1,234.50 03/05/2024')
  })

  it('formats a computed expression by its runtime kind and its function return type', () => {
    expect(render('{{ addDays(fields.due, 1) | date.pattern="MM/DD/YYYY" }}')).toBe('03/06/2024')
    expect(render('{{ fields.qty * 2 | locale="de-DE" }}')).toBe((2469).toLocaleString('de-DE'))
    expect(() => render('{{ "x" + fields.note | date.pattern="MM/DD/YYYY" }}')).toThrowError(/date\.pattern applies to dates, not to a string value/)
  })

  it('passes modifiers to the branch a conditional or coalesce prints', () => {
    expect(render('{{ fields.approved ? fields.due : deadline | date.pattern="MM/DD/YYYY" }}')).toBe('03/05/2024')
    expect(render('{{ coalesce(fields.missing, fields.due) | date.pattern="MM/DD/YYYY" }}')).toBe('03/05/2024')
    expect(render('{{ coalesce(fields.due, "n/a") | date.pattern="MM/DD/YYYY" }}', { data: { ...data, due: null } })).toBe('n/a')
    expect(check('{{ coalesce(fields.due, "n/a") | date.pattern="MM/DD/YYYY" }}')).toEqual([])
    expect(check('{{ coalesce(fields.note, "n/a") | date.pattern="MM/DD/YYYY" }}')).toEqual([
      expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(/date\.pattern applies to dates, not to fields\.note, a text value/) }),
    ])
  })

  it('refuses at render, as at check, a modifier no branch of a conditional or coalesce takes', () => {
    for (const template of [
      '{{ coalesce(fields.note, "fallback") | date.pattern="MM/DD/YYYY" }}',
      '{{ fields.approved ? fields.note : "x" | date.pattern="MM/DD/YYYY" }}',
      '{{ fields.approved ? "x" : fields.qty | money.currencyDisplay="none" }}',
    ]) {
      const [problem] = check(template)
      expect(problem, template).toMatchObject({ code: 'format-modifier' })
      expect(() => render(template), template).toThrowError(problem!.message)
    }
  })

  it('types the rows of a computed loop source the same at check and at render', () => {
    const templates = [
      '{{#each coalesce(fields.dates, fields.dates)}}{{ item | date.pattern="MM/DD/YYYY" }} {{/each}}',
      '{{#each fields.approved ? fields.dates : fields.dates}}{{ item | date.pattern="MM/DD/YYYY" }} {{/each}}',
    ]
    for (const template of templates) {
      expect(check(template), template).toEqual([])
      expect(render(template), template).toBe('07/08/2024 09/10/2024 ')
    }
    expect(render('{{#each coalesce(fields.missing, fields.lines)}}{{ item.when | date.pattern="MM/DD/YYYY" }} {{/each}}')).toBe('01/02/2024 11/12/2024 ')
    for (const template of [
      '{{#each [fields.due]}}{{ item | date.pattern="MM/DD/YYYY" }}{{/each}}',
      '{{#each coalesce(fields.lines, fields.lines)}}{{ item.name | date.pattern="MM/DD/YYYY" }}{{/each}}',
    ]) {
      const [problem] = check(template)
      expect(problem, template).toMatchObject({ code: 'format-modifier' })
      expect(() => render(template), template).toThrowError(problem!.message)
    }
  })

  it('formats parties and annexes by their shapes, and refuses kinds the modifier does not take', () => {
    expect(render('{{ parties.tenant | locale="en-US" }} {{ annexes.lease | locale="en-US" }}')).toBe(render('{{ parties.tenant }} {{ annexes.lease }}'))
    expect(check('{{ parties.tenant | date.pattern="MM/DD/YYYY" }}')).toEqual([
      expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(/not to parties\.tenant, a party value/) }),
    ])
    expect(check('{{ annexes.lease | money.currencyDisplay="none" }}')).toEqual([
      expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(/not to annexes\.lease, an attachment value/) }),
    ])
  })

  it('formats a member of a structured value by its presentation kind', () => {
    expect(render('{{ fields.price.amount | locale="de-DE" }}|{{ fields.price.amount }}')).toBe('1.234,5|1234.5')
    expect(render('{{ fields.lines[0].cost.amount | locale="de-DE" }}|{{ fields.id.issueDate | date.pattern="MM/DD/YYYY" }}')).toBe('5|01/31/2020')
    expect(check('{{ fields.price.amount | locale="de-DE" }}{{ fields.id.issueDate | date.pattern="MM/DD/YYYY" }}')).toEqual([])
    expect(check('{{ fields.price.currency | date.pattern="MM/DD/YYYY" }}')).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/not to fields\.price\.currency, a text value/) }),
    ])
  })

  describe('a key that needs the metadata of the value a member sits in', () => {
    beforeAll(() => {
      FORMAT_MODIFIER_RULES.set('test.region', {
        value: (value) => typeof value === 'string' ? undefined : 'test.region takes a string.',
        applies: (target) => {
          if (target.declared?.source !== 'member' || target.declared.member !== 'region' || target.owner?.declared.kind !== 'address') {
            return 'test.region applies to the region of an address.'
          }
          const owner = target.owner
          const address = owner.value as Record<string, unknown> | undefined
          return 'value' in owner && !/^[A-Z]{2}$/.test(String(address?.country)) ? 'test.region needs the address\'s country code.' : undefined
        },
      })
    })
    afterAll(() => {
      FORMAT_MODIFIER_RULES.delete('test.region')
    })

    it('reads the declared owner at check and its raw value at render', () => {
      expect(check('{{ fields.home.region | test.region="name" }}')).toEqual([])
      expect(check('{{ fields.note | test.region="name" }}')).toEqual([
        expect.objectContaining({ code: 'format-modifier', message: 'test.region applies to the region of an address.' }),
      ])
      expect(render('{{ fields.home.region | test.region="name" }}')).toBe('ON')
      expect(() => render('{{ fields.home.region | test.region="name" }}', { data: { ...data, home: { ...data.home, country: 'Canada' } } }))
        .toThrowError(/test\.region needs the address's country code/)
    })
  })

  describe('country and region keys', () => {
    const places = {
      kind: 'form',
      name: 'places',
      fields: {
        home: { type: 'address', label: 'Home', codes: true },
        born: { type: 'country', label: 'Born' },
        state: { type: 'region', label: 'State', country: 'US' },
        homes: { type: 'list', label: 'Homes', item: { type: 'address', label: 'Home' } },
        note: { type: 'text', label: 'Note' },
      },
    } as unknown as Form
    const placeData = {
      home: { line1: '1 Main St', locality: 'Ottawa', region: 'ON', postalCode: 'K1A 0B1', country: 'CA' },
      born: 'DE',
      state: 'US-TX',
      homes: [{ line1: '1 Rue X', locality: 'Lyon', region: 'ARA', postalCode: '69001', country: 'FR' }],
      note: 'CA',
    }
    const placeEnv = createTypeEnv({
      fields: T.object,
      'fields.home': T.object,
      'fields.home.country': T.string,
      'fields.home.region': T.string,
      'fields.born': T.string,
      'fields.state': T.string,
      'fields.homes': T.array(T.object),
      'fields.homes.region': T.string,
      'fields.note': T.string,
    })
    const placeRender = (template: string, fields: Record<string, unknown> = placeData) => renderText({ form: places, data: fields, template })
    const placeCheck = (template: string) => checkTextTemplate(template, placeEnv, { values: formValueResolver(places) })

    it('print country fields and address countries as codes or names', () => {
      expect(placeRender('{{ fields.born | country.display="name" }}|{{ fields.born }}')).toBe('Germany|DE')
      expect(placeRender('{{ fields.home.country | country.display="name", locale="fr-FR" }}|{{ fields.home.country }}')).toBe('Canada|CA')
      expect(placeRender('{{ fields.born | country.display="name", locale="fr-FR" }}')).toBe('Allemagne')
      expect(placeCheck('{{ fields.born | country.display="name" }}{{ fields.home.country | country.display="code" }}')).toEqual([])
    })

    it('print region fields and address regions as code, full code or name, reading the address country', () => {
      expect(placeRender('{{ fields.state | region.display="code" }}|{{ fields.state | region.display="name" }}|{{ fields.state }}')).toBe('TX|Texas|US-TX')
      expect(placeRender('{{ fields.home.region | region.display="full" }}|{{ fields.home.region | region.display="name" }}')).toBe('CA-ON|Ontario')
      expect(placeRender('{{#each fields.homes}}{{ item.region | region.display="name" }}{{/each}}')).toBe('Auvergne-Rhône-Alpes')
      expect(placeCheck('{{#each fields.homes}}{{ item.region | region.display="name" }}{{/each}}')).toEqual([])
    })

    it('print a whole address with its country and region named', () => {
      expect(placeRender('{{ fields.home | country.display="name", region.display="name" }}')).toBe('1 Main St, Ottawa, Ontario, K1A 0B1, Canada')
    })

    it('refuse a wrong value and a kind the key does not take, at check and at render', () => {
      for (const [template, message] of [
        ['{{ fields.born | country.display="full" }}', /country\.display takes "code", "name", not "full"/],
        ['{{ fields.note | country.display="name" }}', /country\.display applies to countries and addresses, not to fields\.note, a text value/],
        ['{{ fields.born | region.display="name" }}', /region\.display applies to subdivisions and addresses, not to fields\.born, a country value/],
      ] as Array<[string, RegExp]>) {
        expect(placeCheck(template), template).toEqual([expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(message) })])
        expect(() => placeRender(template), template).toThrowError(TemplateError)
      }
    })

    it('refuse an address region at render when its address has no country', () => {
      const rule = FORMAT_MODIFIER_RULES.get('region.display')!
      const declared = formValueResolver(places).describe(['fields', 'home', 'region'])!
      const owner = declared.source === 'member' ? declared.owner : declared
      expect(rule.applies({ kind: 'region', declared, owner: { declared: owner } }, 'name')).toBeUndefined()
      expect(rule.applies({ kind: 'region', declared, owner: { declared: owner, value: placeData.home } }, 'name')).toBeUndefined()
      expect(rule.applies({ kind: 'region', declared, owner: { declared: owner, value: { ...placeData.home, country: ' ' } } }, 'name'))
        .toBe('region.display reads fields.home.region in its address country, and fields.home.country is empty.')
    })

    it('fail with the outcome code when a stored value does not normalize', () => {
      expect(() => placeRender('{{ fields.home.country | country.display="name" }}', { ...placeData, home: { ...placeData.home, country: 'Atlantis' } }))
        .toThrowError(expect.objectContaining({ issues: [expect.objectContaining({ code: 'unknown_country', path: 'fields.home.country' })] }))
    })
  })

  it('applies modifiers before HTML escaping, in {{ }} and {{{ }}}', () => {
    const html = { mimeType: 'text/html' }
    expect(render('{{ fields.note | locale="en-US" }}|{{{ fields.note | locale="en-US" }}}|{{{ fields.due | date.pattern="MM/DD/YYYY" }}}', html))
      .toBe('A &amp; &lt;B&gt;|A & <B>|03/05/2024')
  })

  it('prints the progressive placeholder for a missing value under a modifier', () => {
    expect(render('[{{ fields.due | date.pattern="MM/DD/YYYY" }}]', { data: {}, progressive: { missing: '___' } })).toBe('[___]')
  })

  it('reads modifiers after the first single | outside a string literal', () => {
    expect(render('{{ coalesce(fields.missing, "a|b") }}')).toBe('a|b')
    expect(render('{{ coalesce(fields.missing, "a|b") | locale="en-US" }}')).toBe('a|b')
    expect(check('{{ fields.due | date.pattern="x, y | z" }}')).toEqual([
      expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(/date\.pattern takes "MM\/DD\/YYYY", "DD\/MM\/YYYY", "YYYY-MM-DD", not "x, y \| z"/) }),
    ])
  })

  it('keeps refusing || with the expression parser\'s own diagnostic', () => {
    const [problem] = check('{{ fields.note || fields.qty }}')
    expect(problem).toMatchObject({ code: 'syntax', expression: 'fields.note || fields.qty', message: expect.stringMatching(/'\|\|' is not supported/) })
    expect(() => render('{{ fields.note || fields.qty }}')).toThrowError(/'\|\|' is not supported/)
    expect(check('{{ fields.note || fields.qty | locale="en-US" }}')).toEqual([
      expect.objectContaining({ code: 'syntax', message: expect.stringMatching(/'\|\|' is not supported/) }),
    ])
  })

  it('refuses modifiers on block markers', () => {
    for (const template of ['{{#each fields.lines | locale="en-US"}}x{{/each}}', '{{#if fields.approved | locale="en-US"}}x{{/if}}']) {
      expect(check(template)).toEqual([expect.objectContaining({ code: 'markers', message: expect.stringMatching(/block marker takes no format modifiers/) })])
      expect(() => render(template)).toThrowError(/block marker takes no format modifiers/)
    }
    expect(check('{{#if fields.approved or fields.qty > 1}}x{{/if}}')).toEqual([])
  })

  it('refuses an unknown key, a wrong value, a repeated key, and malformed modifiers, at check and at render', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['{{ fields.due | colour="red" }}', 'format-modifier', /Unknown format modifier "colour"\. Known modifiers: locale, date\.pattern, money\.currencyDisplay/],
      ['{{ fields.due | date.pattern="M/D/Y" }}', 'format-modifier', /date\.pattern takes/],
      ['{{ fields.due | date.pattern=1 }}', 'format-modifier', /not 1\./],
      ['{{ fields.price | money.currencyDisplay=true }}', 'format-modifier', /not true\./],
      ['{{ fields.due | locale="not a tag" }}', 'format-modifier', /BCP 47/],
      ['{{ fields.due | locale="en-a" }}', 'format-modifier', /BCP 47 language tag such as "en-US", not "en-a"/],
      ['{{ fields.due | locale="en-US", locale="fr-FR" }}', 'format-modifier', /written more than once/],
      ['{{ fields.due | }}', 'syntax', /written key=value/],
      ['{{ fields.due | date.pattern }}', 'syntax', /needs a value/],
      ['{{ fields.due | date.pattern="MM/DD/YYYY }}', 'syntax', /no closing quote/],
      ['{{ fields.due | date.pattern=MM }}', 'syntax', /string, number, or boolean literal/],
      ['{{ fields.due | locale="en-US", }}', 'syntax', /written key=value/],
      ['{{ fields.due | locale="en-US" date.pattern="MM/DD/YYYY" }}', 'syntax', /Separate format modifiers with commas/],
    ]
    for (const [template, code, message] of cases) {
      expect(check(template), template).toEqual([expect.objectContaining({ code, message: expect.stringMatching(message) })])
      expect(() => render(template), template).toThrowError(TemplateError)
    }
  })

  it('names where a modifier problem sits', () => {
    expect(check('Line\n  {{ fields.due | locale="en-US", colour="red" }}')).toEqual([{
      code: 'format-modifier',
      message: expect.any(String),
      expression: 'fields.due | locale="en-US", colour="red"',
      position: { line: 2, column: 35 },
    }])
    expect(check('{{ fields.due | date.pattern="MM/DD/YYYY", locale="en-a" }}')).toEqual([
      expect.objectContaining({ position: { line: 1, column: 44 } }),
    ])
    expect(() => render('{{ fields.due | date.pattern="MM/DD/YYYY", locale="en-a" }}')).toThrowError(/line 1, column 44 .*not "en-a"/)
  })

  it('refuses a key that does not apply to the value\'s kind, at check and at render', () => {
    const cases: Array<[string, RegExp]> = [
      ['{{ fields.note | date.pattern="MM/DD/YYYY" }}', /date\.pattern applies to dates, not to fields\.note, a text value/],
      ['{{ fields.due | money.currencyDisplay="none" }}', /money\.currencyDisplay applies to money values, not to fields\.due, a date value/],
      ['{{ fields.lines | locale="en-US" }}', /fields\.lines holds several; write them on a placeholder inside \{\{#each\}\}/],
      ['{{ fields.lines[0] | locale="en-US" }}', /fields\.lines\[0\] holds several/],
      ['{{ parties.witnesses | locale="en-US" }}', /parties\.witnesses holds several/],
      ['{{ fields.home.country | date.pattern="MM/DD/YYYY" }}', /not to fields\.home\.country, a country value/],
      ['{{#each fields.lines}}{{ item.name | date.pattern="MM/DD/YYYY" }}{{/each}}', /not to fields\.lines\[0\]\.name, a text value/],
    ]
    for (const [template, message] of cases) {
      expect(check(template), template).toEqual([expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(message) })])
      expect(() => render(template), template).toThrowError(TemplateError)
    }
  })

  it('checks a path against its field type, and a computed expression against its static type', () => {
    expect(check('{{ fields.due | date.pattern="MM/DD/YYYY" }}{{ addDays(fields.due, 1) | date.pattern="MM/DD/YYYY" }}{{ fields.price.amount * 2 | locale="fr-FR" }}')).toEqual([])
    expect(check('{{ dateDiff(fields.due, fields.due) | date.pattern="MM/DD/YYYY" }}')).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/not to a number value/) }),
    ])
    expect(checkTextTemplate('{{ fields.due | date.pattern="MM/DD/YYYY" }}', env)).toEqual([])
    expect(checkTextTemplate('{{ fields.home | date.pattern="MM/DD/YYYY" }}', env)).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/not to an object value/) }),
    ])
  })

  it('refuses modifiers on a signing directive', () => {
    expect(check('{{ signature(parties.tenant, "sign") | locale="en-US" }}')).toEqual([
      expect.objectContaining({ code: 'format-modifier', message: expect.stringMatching(/signing directive/) }),
    ])
    expect(() => render('{{ signature(parties.tenant, "sign") | locale="en-US" }}')).toThrowError(/signing directive/)
  })

  it('renders a template with no modifiers as before', () => {
    const template = '{{ fields.due }} {{ fields.price }} {{ fields.qty }} {{ fields.note }} {{ total }} {{ coalesce(fields.approved, false) }} {{#each fields.lines}}{{ item.when }}/{{ item.cost }};{{/each}} {{ fields.lines[0].dates }}'
    expect(render(template)).toBe('Mar 5, 2024 $1,234.50 1,234.5 A & <B> $1,234.50 Yes Jan 2, 2024/$5.00;Nov 12, 2024/$7.00; 2024-07-08, 2024-09-10')
    expect(check(template)).toEqual([])
  })
})

describe('format modifiers in Word templates', () => {
  const expected = '03/05/2024'

  it('reads modifiers from a placeholder split across runs at the pipe, at a key, and inside a quoted literal', async () => {
    const template = docx({
      'word/document.xml': [
        runs('{{ fields.due ', '| date.pattern="MM/DD/YYYY" }}'),
        runs('{{ fields.due | date.pat', 'tern="MM/DD/YYYY" }}'),
        runs('{{ fields.due | date.pattern="MM/', 'DD/YYYY" }}'),
      ],
    }, (paragraph) => paragraph)
    expect(checkDocxTemplate(template, env, { values })).toEqual([])
    expect(wordText(await renderDocx({ template, form, data }))).toBe(expected.repeat(3))
  })

  it('accepts curly quotes and XML entities in modifier values', async () => {
    const template = docx({
      'word/document.xml': [
        '{{ fields.due | date.pattern=“MM/DD/YYYY” }}',
        '{{ fields.due | date.pattern=&quot;MM/DD/YYYY&quot; }}',
        runs('{{ fields.due | date.pattern=“MM/DD', '/YYYY” }}'),
      ].map((text) => text.startsWith('<w:p>') ? text : runs(text)),
    }, (paragraph) => paragraph)
    expect(checkDocxTemplate(template, env, { values })).toEqual([])
    expect(wordText(await renderDocx({ template, form, data }))).toBe(expected.repeat(3))
  })

  it('keeps printed values XML-escaped in {{ }} and {{{ }}}', async () => {
    const template = docx({ 'word/document.xml': ['{{ fields.note | locale="en-US" }}|{{{ fields.note | locale="en-US" }}}'] })
    const xml = partXml(await renderDocx({ template, form, data }))
    expect(xml).toContain('A &amp; &lt;B&gt;|A &amp; &lt;B&gt;')
  })

  it('formats rows of a named loop', async () => {
    const template = docx({ 'word/document.xml': ['{{FOR line IN fields.lines}}', '{{ line.when | date.pattern="MM/DD/YYYY" }} {{ line.cost | money.currencyDisplay="none" }}', '{{END-FOR line}}'] })
    expect(checkDocxTemplate(template, env, { values })).toEqual([])
    expect(wordText(await renderDocx({ template, form, data }))).toBe('01/02/2024 5.0011/12/2024 7.00')
    const wrong = docx({ 'word/document.xml': ['{{FOR line IN fields.lines}}', '{{ line.name | date.pattern="MM/DD/YYYY" }}', '{{END-FOR line}}'] })
    expect(checkDocxTemplate(wrong, env, { values })).toEqual([
      expect.objectContaining({ code: 'format-modifier', location: 'word/document.xml paragraph 2', message: expect.stringMatching(/fields\.lines\[0\]\.name, a text value/) }),
    ])
  })

  it('types the rows of a computed named loop the same at check and at render', async () => {
    const template = docx({ 'word/document.xml': ['{{FOR day IN coalesce(fields.dates, fields.dates)}}', '{{ day | date.pattern="MM/DD/YYYY" }};', '{{END-FOR day}}'] })
    expect(checkDocxTemplate(template, env, { values })).toEqual([])
    expect(wordText(await renderDocx({ template, form, data }))).toBe('07/08/2024;09/10/2024;')
    const wrong = docx({ 'word/document.xml': ['{{FOR day IN [fields.due]}}', '{{ day | date.pattern="MM/DD/YYYY" }}', '{{END-FOR day}}'] })
    const [problem] = checkDocxTemplate(wrong, env, { values })
    expect(problem).toMatchObject({ code: 'format-modifier' })
    await expect(renderDocx({ template: wrong, form, data })).rejects.toThrowError(problem!.message)
  })

  it('formats placeholders in header and footer parts, and checks them there', async () => {
    const template = docx({
      'word/document.xml': ['Body'],
      'word/header1.xml': ['{{ fields.due | date.pattern="MM/DD/YYYY" }}'],
      'word/footer1.xml': ['{{ fields.price | money.currencyDisplay="none" }}'],
    })
    const output = await renderDocx({ template, form, data })
    expect(wordText(output, 'word/header1.xml')).toBe(expected)
    expect(wordText(output, 'word/footer1.xml')).toBe('1,234.50')
    const wrong = docx({ 'word/document.xml': ['Body'], 'word/footer1.xml': ['{{ fields.note | date.pattern="MM/DD/YYYY" }}'] })
    expect(checkDocxTemplate(wrong, env, { values })).toEqual([
      expect.objectContaining({ code: 'format-modifier', location: 'word/footer1.xml paragraph 1' }),
    ])
    await expect(renderDocx({ template: wrong, form, data })).rejects.toThrowError(/word\/footer1\.xml paragraph 1/)
  })

  it('refuses modifiers on a control command', async () => {
    const template = docx({ 'word/document.xml': ['{{FOR line IN fields.lines | locale="en-US"}}', 'x', '{{END-FOR line}}'] })
    expect(checkDocxTemplate(template, env, { values })).toEqual([
      expect.objectContaining({ code: 'markers', message: expect.stringMatching(/block marker takes no format modifiers/) }),
    ])
    await expect(renderDocx({ template, form, data })).rejects.toThrowError(/block marker takes no format modifiers/)
  })

  it('renders a Word template with no modifiers as before', async () => {
    const template = docx({ 'word/document.xml': ['{{ fields.due }} {{ fields.price }} {{ fields.note }}'] })
    expect(wordText(await renderDocx({ template, form, data }))).toBe('Mar 5, 2024 $1,234.50 A &amp; &lt;B&gt;')
  })
})
