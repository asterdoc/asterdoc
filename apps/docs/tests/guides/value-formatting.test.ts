/**
 * Tests for code snippets in guides/value-formatting.mdx
 */
import { describe, test, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { a, createFormatter, phoneProvider, validate } from '@asterdoc/sdk'
import { inspectAcroFormFields } from '@asterdoc/render/pdf'
import { createFsResolver } from '@asterdoc/resolvers/fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pdfs = path.resolve(__dirname, '../fixtures/pdfs')

describe('Formatting values guide', () => {
  describe('worked example', () => {
    const intake = a.form({
      name: 'intake',
      fields: {
        name: { type: 'person', label: 'Name' },
        birthCountry: { type: 'country', label: 'Country of birth' },
        state: { type: 'region', label: 'State', country: 'US' },
        ssn: { type: 'text', label: 'SSN', mask: '###-##-####' },
        phone: { type: 'phone', label: 'Phone' },
        dob: { type: 'date', label: 'Date of birth' },
        fee: { type: 'money', label: 'Fee' },
      },
      layers: {
        summary: {
          kind: 'inline',
          mimeType: 'text/plain',
          format: {
            locale: 'en-US',
            country: { display: 'name' },
            region: { display: 'name' },
            phone: { style: 'national' },
            date: { pattern: 'MM/DD/YYYY' },
          },
          text: [
            'Name: {{ fields.name | person.order="family-first", case="upper" }}',
            'Born in: {{ fields.birthCountry }}',
            'State: {{ fields.state }} ({{ fields.state | region.display="code" }})',
            'SSN: {{ fields.ssn }} / {{ fields.ssn | text.mask=false }}',
            'Phone: {{ fields.phone }}',
            'Born: {{ fields.dob }}, year {{ fields.dob | part="year" }}',
            'Fee: {{ fields.fee | money.fractionDigits=0 }}',
          ].join('\n'),
        },
      },
    })

    const draft = intake.fill({
      fields: {
        name: { name: 'Jane Q. Doe', firstName: 'Jane', middleName: 'Q.', lastName: 'Doe' },
        birthCountry: 'Canada',
        state: 'California',
        ssn: '123-45-6789',
        phone: { number: '+12025550143' },
        dob: '1990-06-15',
        fee: { amount: 1234.5, currency: 'USD' },
      },
    })

    test('stores codes and canonical values', () => {
      expect(draft.fields.birthCountry).toBe('CA')
      expect(draft.fields.state).toBe('US-CA')
      expect(draft.fields.ssn).toBe('123456789')
    })

    test('prints the layer format and the placeholder modifiers', async () => {
      const output = await draft.render({ layer: 'summary' })
      expect(output).toBe([
        'Name: DOE, JANE Q.',
        'Born in: Canada',
        'State: California (CA)',
        'SSN: 123-45-6789 / 123456789',
        'Phone: (202) 555-0143',
        'Born: 06/15/1990, year 1990',
        'Fee: $1,235',
      ].join('\n'))
    })

    test('the same data prints as stored on a layer with no format', async () => {
      const plain = a.form({
        name: 'intake-plain',
        fields: { birthCountry: { type: 'country', label: 'Country of birth' }, ssn: { type: 'text', label: 'SSN', mask: '###-##-####' } },
        layers: { summary: { kind: 'inline', mimeType: 'text/plain', text: '{{ fields.birthCountry }} {{ fields.ssn }}' } },
      })
      const output = await plain.fill({ fields: { birthCountry: 'Canada', ssn: '123456789' } }).render({ layer: 'summary' })
      expect(output).toBe('CA 123-45-6789')
    })
  })

  describe('format object table', () => {
    const formatter = createFormatter({ locale: 'en-US', providers: { phone: phoneProvider } })

    test('phone styles print as the table shows', () => {
      const phone = { number: '+12025550143' }
      expect(formatter.formatPhone(phone, { style: 'e164' })).toBe('+12025550143')
      expect(formatter.formatPhone(phone, { style: 'international' })).toBe('+1 202 555 0143')
      expect(formatter.formatPhone(phone, { style: 'national' })).toBe('(202) 555-0143')
      expect(formatter.formatPhone(phone, { style: 'digits' })).toBe('2025550143')
    })

    test('a phone style without the phone provider fails with missing_format_provider', () => {
      const lean = createFormatter({ locale: 'en-US' })
      const result = lean.safeFormatPhone({ number: '+12025550143' }, { style: 'national' })
      expect(result.success).toBe(false)
      expect(result.success ? undefined : result.issues[0]?.code).toBe('missing_format_provider')
    })
  })

  describe('template modifier check', () => {
    const definition = {
      $schema: 'https://schema.asterdoc.com/2026-11-10.json',
      kind: 'form',
      name: 'modifiers',
      version: '1.0.0',
      fields: { note: { type: 'text', label: 'Note' }, dob: { type: 'date', label: 'Date of birth' } },
      layers: { summary: { kind: 'inline', mimeType: 'text/plain', text: '{{ fields.note | phone.style="national" }}' } },
    }

    test('a key that does not apply to the value kind is a template error', () => {
      const result = validate(definition)
      expect(result.issues?.map((issue) => issue.message)).toEqual([
        'Template error at layer "summary", line 1, column 18 in {{fields.note | phone.style="national"}}: phone.style applies to phone numbers, not to fields.note, a text value.',
      ])
    })

    test('a modifier that applies passes', () => {
      const result = validate({ ...definition, layers: { summary: { kind: 'inline', mimeType: 'text/plain', text: '{{ fields.dob | part="year" }}' } } })
      expect(result.issues).toBeUndefined()
    })
  })

  describe('reading a filled PDF back', () => {
    const P = 'topmostSubform[0].Page1[0].'
    const w9 = a.form({
      name: 'w9-format',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        ssn: { type: 'text', label: 'SSN', mask: '###-##-####' },
      },
      layers: {
        pdf: {
          kind: 'file',
          mimeType: 'application/pdf',
          path: 'w9.pdf',
          format: { case: 'upper' },
          bindings: {
            [`${P}f1_01[0]`]: 'fields.name',
            [`${P}f1_11[0]`]: 'fields.ssn:1',
            [`${P}f1_12[0]`]: 'fields.ssn:2',
            [`${P}f1_13[0]`]: 'fields.ssn:3',
          },
        },
      },
    }, { resolver: createFsResolver({ root: pdfs }) })

    test('upper case prints, and reads back lossy; mask groups join back exactly', async () => {
      const pdf = await w9.fill({ fields: { name: 'Jordan Lee', ssn: '000123456' } }).render({ layer: 'pdf' })
      if (typeof pdf === 'string') throw new Error('a PDF layer renders bytes')
      const printed = Object.fromEntries((await inspectAcroFormFields(new Uint8Array(pdf))).filter((field) => field.value).map((field) => [field.name, field.value]))
      expect(printed[`${P}f1_01[0]`]).toBe('JORDAN LEE')
      expect([printed[`${P}f1_11[0]`], printed[`${P}f1_12[0]`], printed[`${P}f1_13[0]`]]).toEqual(['000', '12', '3456'])

      const { data, report } = await w9.extract(pdf)
      expect(data.fields).toEqual({ name: 'JORDAN LEE', ssn: '000123456' })
      expect(report.entries.find((entry) => entry.path === 'name')?.lossy).toBe(true)
      expect(report.entries.find((entry) => entry.path === 'ssn')?.lossy).toBe(false)
    })
  })
})
