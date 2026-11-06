import type { Form, LayerFormat } from '@asterdoc/types'
import { createFormatter } from '@asterdoc/format'
import { describe, expect, it } from 'vitest'
import { extractPdfData, renderPdf } from '../src/pdf'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { ArtifactFieldFormatError, formatFieldData } from '../src/text/field-formatter'
import { acroFormPdf } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'date-fixture',
  version: '1.0.0',
  title: 'Date fixture',
  fields: { accredited: { type: 'date', label: 'Date of accreditation' } },
} as unknown as Form

const bindings = { accredited: 'accredited' }
const data = { fields: { accredited: '2021-06-05' } }
const template = () => acroFormPdf([{ kind: 'text', name: 'accredited' }])
const box = async (pdf: Uint8Array) => (await inspectAcroFormFields(pdf)).find((field) => field.name === 'accredited')?.value

describe('a PDF layer that declares its date pattern', () => {
  it.each([
    ['MM/DD/YYYY', '06/05/2021'],
    ['DD/MM/YYYY', '05/06/2021'],
    ['YYYY-MM-DD', '2021-06-05'],
  ] as const)('prints %s as the template asks', async (pattern, printed) => {
    expect(await box(await renderPdf({ template: template(), form, data, bindings, format: { date: { pattern } } }))).toBe(printed)
  })

  it('prints the formatter date when the layer declares no pattern', async () => {
    expect(await box(await renderPdf({ template: template(), form, data, bindings }))).toBe('Jun 5, 2021')
  })

  it.each(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const)('reads %s back to the same calendar date', async (pattern) => {
    const format: LayerFormat = { date: { pattern } }
    const pdf = await renderPdf({ template: template(), form, data, bindings, format })
    const result = await extractPdfData({ pdf, form, bindings, format })
    expect(result.data.fields).toMatchObject({ accredited: '2021-06-05' })
  })

  it('reads day-first text by the pattern, not by the locale order', async () => {
    const format: LayerFormat = { date: { pattern: 'DD/MM/YYYY' } }
    const pdf = acroFormPdf([{ kind: 'text', name: 'accredited', value: '05/06/2021' }])
    const result = await extractPdfData({ pdf, form, bindings, format, formatter: createFormatter({ locale: 'en-US' }) })
    expect(result.data.fields).toMatchObject({ accredited: '2021-06-05' })
  })

  it('reports text that does not follow the pattern as unparseable', async () => {
    const format: LayerFormat = { date: { pattern: 'MM/DD/YYYY' } }
    const pdf = acroFormPdf([{ kind: 'text', name: 'accredited', value: 'Jun 5, 2021' }])
    const result = await extractPdfData({ pdf, form, bindings, format })
    expect(result.report.entries.find((entry) => entry.path === 'accredited')).toMatchObject({ status: 'unparseable' })
    expect(result.data.fields).not.toHaveProperty('accredited')
  })

  it('reports an impossible day as unparseable', async () => {
    const format: LayerFormat = { date: { pattern: 'MM/DD/YYYY' } }
    const pdf = acroFormPdf([{ kind: 'text', name: 'accredited', value: '02/30/2021' }])
    const result = await extractPdfData({ pdf, form, bindings, format })
    expect(result.report.entries.find((entry) => entry.path === 'accredited')).toMatchObject({ status: 'unparseable' })
  })

  it('refuses a value that is not a date', () => {
    expect(() => formatFieldData({ fields: { accredited: '2021-13-40' } }, form, createFormatter({ locale: 'en-US' }), { date: { pattern: 'MM/DD/YYYY' } }))
      .toThrow(ArtifactFieldFormatError)
  })

  it('refuses an instant, which has no calendar day without a time zone', () => {
    expect(() => formatFieldData({ fields: { accredited: new Date(Date.UTC(2021, 5, 5)) } }, form, createFormatter({ locale: 'en-US' }), { date: { pattern: 'MM/DD/YYYY' } }))
      .toThrow(/YYYY-MM-DD/)
  })
})
