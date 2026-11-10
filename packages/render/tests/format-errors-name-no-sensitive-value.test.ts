import type { Bindings, Form, LayerFormat } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { renderPdf } from '../src/pdf'
import { ArtifactFieldFormatError, renderText } from '../src/text'
import { withoutSensitiveValues } from '../src/text/field-formatter'
import { acroFormPdf, textFieldsPdf } from './pdf-fixtures'

const form = (sensitive: boolean): Form => ({
  kind: 'form',
  name: 'sensitive-formats',
  fields: {
    phone: { type: 'phone', sensitive },
    born: { type: 'date', sensitive },
    stay: { type: 'duration', sensitive },
    refund: { type: 'money', sensitive },
    yen: { type: 'money', sensitive },
    status: { type: 'enum', sensitive, enum: [{ value: 'a', label: 'A' }] },
    ssn: { type: 'text', mask: '###-##-####', sensitive },
    land: { type: 'country', sensitive },
    home: { type: 'address', sensitive },
  },
} as unknown as Form)

const values = {
  phone: { number: '+442079460958' },
  born: '1990-02-31',
  stay: 'P1Q',
  refund: { amount: -3.5, currency: 'USD' },
  yen: { amount: 500, currency: 'JPY' },
  status: 'secret-option',
  ssn: '98765',
  land: 'Atlantisland',
  home: { line1: '1 Main St', locality: 'Springfield', region: 'Neverwhere', postalCode: '62701', country: 'Atlantisland' },
}

const failure = async (run: () => unknown): Promise<ArtifactFieldFormatError> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof ArtifactFieldFormatError) return error
    throw error
  }
  throw new Error('expected a format error, and the render succeeded')
}

const only = (key: keyof typeof values) => ({ fields: { [key]: values[key] } })
const text = (sensitive: boolean, key: keyof typeof values, template: string, format?: LayerFormat) =>
  failure(() => renderText({ form: form(sensitive), data: only(key), template, ...(format && { format }) }))
const pdf = (sensitive: boolean, key: keyof typeof values, bindings: Bindings, format?: LayerFormat) =>
  failure(() => renderPdf({ form: form(sensitive), data: only(key), template: acroFormPdf(Object.keys(bindings).map((name) => ({ kind: 'text' as const, name }))), bindings, ...(format && { format }) }))

const leaked = (error: ArtifactFieldFormatError, secret: string) => JSON.stringify({ message: error.message, issues: error.issues }).includes(secret)

describe('a format error over a sensitive value names it only by kind and length', () => {
  const cases: Array<[string, (sensitive: boolean) => Promise<ArtifactFieldFormatError>, string]> = [
    ['a phone style for another region, in a text layer', (s) => text(s, 'phone', '{{ fields.phone }}', { phone: { style: 'national', region: 'US' } }), '2079460958'],
    ['a phone part for another region', (s) => text(s, 'phone', '{{ fields.phone | part="nationalNumber", phone.region="US" }}'), '2079460958'],
    ['a +1-only phone part', (s) => text(s, 'phone', '{{ fields.phone | part="areaCode" }}'), '2079460958'],
    ['a phone part in a PDF binding', (s) => pdf(s, 'phone', { box: { path: 'phone', part: 'areaCode' } }), '2079460958'],
    ['a phone style for another region in a PDF layer', (s) => pdf(s, 'phone', { box: 'phone' }, { phone: { style: 'national', region: 'US' } }), '2079460958'],
    ['an impossible date', (s) => text(s, 'born', '{{ fields.born }}'), '1990-02-31'],
    ['an invalid duration', (s) => text(s, 'stay', '{{ fields.stay }}'), 'P1Q'],
    ['a negative money part', (s) => pdf(s, 'refund', { box: { path: 'refund', part: 'units' } }), '3.5'],
    ['a money part in a currency without cents', (s) => pdf(s, 'yen', { box: { path: 'yen', part: 'cents' } }), 'JPY'],
    ['an undeclared option', (s) => text(s, 'status', '{{ fields.status }}'), 'secret-option'],
    ['a masked value that does not fit', (s) => text(s, 'ssn', '{{ fields.ssn }}'), '98765'],
    ['an unknown country in a country field', (s) => text(s, 'land', '{{ fields.land | country.display="name" }}'), 'Atlantisland'],
    ['an unknown country in an address', (s) => text(s, 'home', '{{ fields.home | country.display="name" }}'), 'Atlantisland'],
    ['an unknown country by address member', (s) => text(s, 'home', '{{ fields.home.country | country.display="name" }}'), 'Atlantisland'],
    ['an unknown country in a PDF binding', (s) => pdf(s, 'home', { box: { path: 'home.country', format: { country: { display: 'name' } } } }), 'Atlantisland'],
  ]

  for (const [name, run, secret] of cases) {
    it(name, async () => {
      const hidden = await run(true)
      expect(leaked(hidden, secret)).toBe(false)
      expect(hidden.message).toContain('[redacted]')
      expect(leaked(await run(false), secret)).toBe(true)
    })
  }

  it('keeps the part name readable', async () => {
    const error = await text(true, 'phone', '{{ fields.phone | part="areaCode" }}')
    expect(error.message).toContain('The phone part "areaCode" exists only for +1 numbers, and [redacted] (string, length 13) has country calling code +44.')
  })
})

describe('a split binding on a masked field read from flat data', () => {
  it('reports the fields. path, so a sensitive value is redacted', async () => {
    const run = (sensitive: boolean) => failure(() => renderPdf({
      form: form(sensitive),
      data: { ssn: '98765' },
      template: textFieldsPdf(['area']),
      bindings: { area: 'ssn:1' },
    }))
    const hidden = await run(true)
    expect(hidden.path).toBe('fields.ssn')
    expect(hidden.message).not.toContain('98765')
    expect((await run(false)).message).toContain('98765')
  })
})

describe('a sensitive format error that carries no value-free message', () => {
  it('prints a fixed text instead of the raw message', () => {
    const raw = new ArtifactFieldFormatError('fields.phone', 'phone', 'invalid', [{ code: 'formatter_error', message: 'custom formatter failed on +442079460958', path: 'fields.phone', kind: 'phone' }])
    const hidden = withoutSensitiveValues(form(true), raw) as ArtifactFieldFormatError
    expect(leaked(hidden, '2079460958')).toBe(false)
    expect(hidden.message).toContain('The value could not be formatted (formatter_error).')
    expect(withoutSensitiveValues(form(false), raw)).toBe(raw)
  })
})
