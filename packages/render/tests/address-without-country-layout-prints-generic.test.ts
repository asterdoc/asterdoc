import { createFormatter } from '@asterdoc/format'
import type { Form } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { renderPdf } from '../src/pdf'
import { ArtifactFieldFormatError, formatFieldData } from '../src/text/field-formatter'
import { acroFormPdf } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'address-fixture',
  version: '1.0.0',
  title: 'Address fixture',
  fields: { mailing: { type: 'address', label: 'Mailing address' } },
} as unknown as Form

const toronto = { line1: '100 Queen St W', locality: 'Toronto', region: 'ON', postalCode: 'M5H 2N2', country: 'CA' }

const text = (data: Record<string, unknown>) => String((data.fields as Record<string, unknown>).mailing)

describe('an address in a country with no address layout', () => {
  it('prints in the generic layout and does not stop the render', () => {
    const formatted = formatFieldData({ fields: { mailing: toronto } }, form, createFormatter({ locale: 'en-US' }))
    expect(text(formatted)).toBe('100 Queen St W, Toronto, ON, M5H 2N2, CA')
  })

  it('keeps the country layout for a country that has one', () => {
    const london = { line1: '10 Downing Street', locality: 'London', region: 'Greater London', postalCode: 'SW1A 2AA', country: 'GB' }
    const formatted = formatFieldData({ fields: { mailing: london } }, form, createFormatter({ locale: 'en-US' }))
    expect(text(formatted)).toBe('10 Downing Street, London, Greater London, SW1A 2AA, GB')
  })

  it('uses a layout the formatter supplies for that country before the generic one', () => {
    const formatter = createFormatter({ locale: 'en-US', address: { countryLayouts: { CA: (address) => `${address.locality} ${address.region}  ${address.postalCode}` } } })
    expect(text(formatFieldData({ fields: { mailing: toronto } }, form, formatter))).toBe('Toronto ON  M5H 2N2')
  })

  it('still refuses an address that is invalid', () => {
    const invalid = { ...toronto, postalCode: 'm5h 2n2' }
    expect(() => formatFieldData({ fields: { mailing: invalid } }, form, createFormatter({ locale: 'en-US' })))
      .toThrow(ArtifactFieldFormatError)
  })

  it('fills the parts a PDF binds', async () => {
    const pdf = await renderPdf({
      template: acroFormPdf([{ kind: 'text', name: 'city' }, { kind: 'text', name: 'postal' }]),
      form,
      data: { fields: { mailing: toronto } },
      bindings: { city: 'mailing.locality', postal: 'mailing.postalCode' },
    })
    const values = Object.fromEntries((await inspectAcroFormFields(pdf)).map((field) => [field.name, field.value]))
    expect(values).toMatchObject({ city: 'Toronto', postal: 'M5H 2N2' })
  })
})
