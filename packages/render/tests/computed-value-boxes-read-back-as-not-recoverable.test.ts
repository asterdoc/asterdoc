import type { Bindings, Form } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { extractPdfData } from '../src/pdf'
import { acroFormPdf, type AcroFormFixtureField } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'computed-boxes',
  version: '1.0.0',
  title: 'Computed boxes',
  fields: {
    agree: { type: 'boolean', label: 'Agree' },
    name: { type: 'text', label: 'Name' },
  },
  defs: {
    eligible: { type: 'boolean', value: 'fields.agree == true' },
    tier: { type: 'text', value: "'gold'" },
    region: { type: 'text', value: "'west'" },
    summary: { type: 'text', value: 'fields.name' },
  },
} as unknown as Form

const bindings: Bindings = {
  agree_box: 'agree',
  name_box: 'name',
  eligible_box: 'defs.eligible',
  tier_radio: 'defs.tier',
  region_choice: 'defs.region',
  summary_text: 'defs.summary',
}

function pdf(filled: boolean): Uint8Array {
  const fields: AcroFormFixtureField[] = [
    { kind: 'checkbox', name: 'agree_box', checked: filled },
    { kind: 'text', name: 'name_box', ...(filled && { value: 'Ada' }) },
    { kind: 'checkbox', name: 'eligible_box', checked: filled },
    { kind: 'radio', name: 'tier_radio', states: ['gold', 'silver'], ...(filled && { selected: 'gold' }) },
    { kind: 'choice', name: 'region_choice', options: ['west', 'east'], ...(filled && { value: 'west' }) },
    { kind: 'text', name: 'summary_text', ...(filled && { value: 'Ada' }) },
  ]
  return acroFormPdf(fields)
}

const statusOf = (result: Awaited<ReturnType<typeof extractPdfData>>, path: string) =>
  result.report.entries.find((entry) => entry.path === path)

describe('a box bound to a computed value', () => {
  it.each(['defs.eligible', 'defs.tier', 'defs.region', 'defs.summary'])('reads %s back as not recoverable when the box holds a value', async (path) => {
    const result = await extractPdfData({ pdf: pdf(true), form, bindings })

    expect(statusOf(result, path)).toMatchObject({
      status: 'not_recoverable',
      reason: 'Computed values are derived from other data, not read back.',
    })
  })

  it.each(['defs.eligible', 'defs.tier', 'defs.region', 'defs.summary'])('reads %s back as empty when the box holds no value', async (path) => {
    const result = await extractPdfData({ pdf: pdf(false), form, bindings })

    expect(statusOf(result, path)).toMatchObject({ status: 'empty' })
  })

  it('leaves computed values out of the data and still reads the field-bound boxes', async () => {
    const result = await extractPdfData({ pdf: pdf(true), form, bindings })

    expect(statusOf(result, 'agree')).toMatchObject({ status: 'recovered' })
    expect(result.data).toEqual({ fields: { agree: true, name: 'Ada' } })
  })

  it('reads an unchecked field-bound checkbox as empty', async () => {
    const result = await extractPdfData({ pdf: pdf(false), form, bindings })

    expect(statusOf(result, 'agree')).toMatchObject({ status: 'empty' })
    expect(result.data).toEqual({ fields: {} })
  })
})
