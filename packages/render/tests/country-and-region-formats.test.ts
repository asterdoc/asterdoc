import type { Bindings, Form } from '@asterdoc/types'
import { createFormatter } from '@asterdoc/format'
import { regionsProvider } from '@asterdoc/format/regions'
import { describe, expect, it } from 'vitest'
import { checkPdfBindingFit, extractPdfData, renderPdf } from '../src/pdf'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { ArtifactFieldFormatError, renderText } from '../src/text'
import { acroFieldsPdf, acroFormPdf, type AcroFormFixtureField } from './pdf-fixtures'

const form = {
  kind: 'form',
  name: 'places',
  version: '1.0.0',
  fields: {
    home: { type: 'address', codes: true },
    legacy: { type: 'address' },
    born: { type: 'country' },
    state: { type: 'region', country: 'US' },
    province: { type: 'region' },
  },
} as unknown as Form

const data = {
  fields: {
    home: { line1: '1 Bay St', locality: 'Toronto', region: 'ON', postalCode: 'M5J 2N8', country: 'CA' },
    legacy: { line1: '1 Rue X', locality: 'Lyon', region: 'Rhône', postalCode: '69001', country: 'Atlantis' },
    born: 'DE',
    state: 'US-CA',
    province: 'CA-QC',
  },
}

const textBoxes = (...names: string[]): AcroFormFixtureField[] => names.map((name) => ({ kind: 'text', name }))

async function values(pdf: Uint8Array): Promise<Record<string, unknown>> {
  return Object.fromEntries((await inspectAcroFormFields(pdf)).map((field) => [field.name, field.value]))
}

describe('country and region formats in a text layer', () => {
  it('print values as stored without a country or region format', () => {
    expect(renderText({ template: '{{fields.born}} {{fields.state}} {{fields.home.country}}', form, data: { fields: { ...data.fields, legacy: undefined } } }))
      .toBe('DE US-CA CA')
  })

  it('print a country as its name or code', () => {
    const fields = { born: data.fields.born, home: data.fields.home }
    expect(renderText({ template: '{{fields.born}}', form, data: { fields }, format: { country: { display: 'name' } } })).toBe('Germany')
    expect(renderText({ template: '{{fields.born}}', form, data: { fields }, format: { country: { display: 'code' } } })).toBe('DE')
  })

  it('print country names in the format locale', () => {
    const fields = { born: data.fields.born }
    expect(renderText({ template: '{{fields.born}}', form, data: { fields }, format: { locale: 'fr-FR', country: { display: 'name' } } })).toBe('Allemagne')
  })

  it('print a subdivision as its code, full code or name', () => {
    const fields = { state: data.fields.state, province: data.fields.province }
    const print = (display: 'code' | 'full' | 'name') => renderText({ template: '{{fields.state}} / {{fields.province}}', form, data: { fields }, format: { region: { display } } })
    expect(print('code')).toBe('CA / QC')
    expect(print('full')).toBe('US-CA / CA-QC')
    expect(print('name')).toBe('California / Quebec')
  })

  it('print an address member by sub-path and the whole address with names, keeping the country layout', () => {
    const fields = { home: data.fields.home }
    const format = { country: { display: 'name' as const }, region: { display: 'name' as const } }
    expect(renderText({ template: '{{fields.home.region}}, {{fields.home.country}}', form, data: { fields }, format })).toBe('Ontario, Canada')
    const us = { home: { line1: '1 Main St', locality: 'Springfield', region: 'IL', postalCode: '62701', country: 'US' } }
    const layout = createFormatter().formatAddress({ ...us.home, region: 'Illinois', country: 'United States' }, { layoutCountry: 'US' })
    expect(renderText({ template: '{{fields.home}}', form, data: { fields: us }, format })).toBe(layout)
    expect(layout).toBe('1 Main St, Springfield, Illinois 62701, United States')
  })

  it('fail with the outcome code and path when a stored value does not normalize', () => {
    const fields = { legacy: data.fields.legacy }
    expect(() => renderText({ template: '{{fields.legacy}}', form, data: { fields }, format: { country: { display: 'name' } } }))
      .toThrow(expect.objectContaining({ name: 'ArtifactFieldFormatError', issues: [expect.objectContaining({ code: 'unknown_country', path: 'fields.legacy.country' })] }))
    expect(() => renderText({ template: '{{fields.legacy}}', form, data: { fields } })).not.toThrow()
  })
})

describe('country and region formats on PDF bindings', () => {
  const template = () => acroFormPdf(textBoxes('country', 'region', 'born', 'state'))

  it('format the bound address member and field values one by one', async () => {
    const bindings: Bindings = {
      country: { path: 'home.country', format: { country: { display: 'name' } } },
      region: { path: 'home.region', format: { region: { display: 'full' } } },
      born: 'born',
      state: 'state',
    }
    const pdf = await renderPdf({ template: template(), form, data, bindings, format: { region: { display: 'code' } } })
    expect(await values(pdf)).toMatchObject({ country: 'Canada', region: 'CA-ON', born: 'DE', state: 'CA' })
  })

  it('fail for a bound value that does not normalize, naming its path', async () => {
    const bindings: Bindings = { country: { path: 'legacy.country', format: { country: { display: 'name' } } } }
    await expect(renderPdf({ template: template(), form, data, bindings })).rejects.toBeInstanceOf(ArtifactFieldFormatError)
    await expect(renderPdf({ template: template(), form, data, bindings })).rejects.toMatchObject({ issues: [{ code: 'unknown_country', path: 'fields.legacy.country' }] })
  })

  it('leave an unbound address that does not normalize alone', async () => {
    const bindings: Bindings = { country: { path: 'home.country', format: { country: { display: 'name' } } } }
    expect(await values(await renderPdf({ template: template(), form, data, bindings }))).toMatchObject({ country: 'Canada' })
  })
})

describe('reading country and region names back', () => {
  const pdf = (country: string, region: string) => acroFormPdf([
    { kind: 'text', name: 'country', value: country },
    { kind: 'text', name: 'region', value: region },
    { kind: 'text', name: 'born', value: 'Germany' },
  ])
  const bindings: Bindings = { country: 'home.country', region: 'home.region', born: 'born' }
  const format = { country: { display: 'name' as const }, region: { display: 'name' as const } }

  it('recovers codes from printed names, reading the region in the bound country', async () => {
    const result = await extractPdfData({ pdf: pdf('Canada', 'Ontario'), form, bindings, format })
    expect(result.data.fields).toEqual({ home: { country: 'CA', region: 'ON' }, born: 'DE' })
    expect(result.report.entries.every((entry) => entry.status === 'recovered' && entry.lossy === false)).toBe(true)
  })

  it('reports a name of more than one place as not recoverable', async () => {
    const result = await extractPdfData({ pdf: pdf('Georgia', 'Atlanta'), form, bindings, format })
    expect(result.report.entries.find((entry) => entry.path === 'home.country')).toMatchObject({ status: 'not_recoverable' })
    expect(result.report.entries.find((entry) => entry.path === 'home.region')).toMatchObject({ status: 'not_recoverable' })
    expect(result.data.fields).toEqual({ born: 'DE' })
  })

  it('recovers a region printed as its full code without a bound country, and checks it against a bound one', async () => {
    const full = { region: { display: 'full' as const }, country: { display: 'name' as const } }
    const alone = await extractPdfData({ pdf: pdf('Canada', 'CA-ON'), form, bindings: { region: 'home.region' }, format: full })
    expect(alone.data.fields).toEqual({ home: { region: 'ON' } })
    const together = await extractPdfData({ pdf: pdf('Canada', 'CA-ON'), form, bindings: { country: 'home.country', region: 'home.region' }, format: full })
    expect(together.data.fields).toEqual({ home: { country: 'CA', region: 'ON' } })
    const contradicted = await extractPdfData({ pdf: pdf('United States', 'CA-ON'), form, bindings: { country: 'home.country', region: 'home.region' }, format: full })
    expect(contradicted.report.entries.find((entry) => entry.path === 'home.region')).toMatchObject({ status: 'unparseable' })
  })

  it('reports a region as not recoverable when its address country is not bound', async () => {
    const result = await extractPdfData({ pdf: pdf('Canada', 'Ontario'), form, bindings: { region: 'home.region' }, format })
    expect(result.report.entries).toEqual([expect.objectContaining({ path: 'home.region', status: 'not_recoverable' })])
  })

  it('reads members as raw text without a country or region format', async () => {
    const result = await extractPdfData({ pdf: pdf('Canada', 'Ontario'), form, bindings: { country: 'home.country', region: 'home.region' } })
    expect(result.data.fields).toEqual({ home: { country: 'Canada', region: 'Ontario' } })
  })
})

describe('the fit check for country and region values', () => {
  const COMB = 1 << 24

  it('measures every country name the format can print', async () => {
    const template = acroFieldsPdf([{ name: 'born', rect: [0, 0, 70, 14] }])
    const names = await checkPdfBindingFit({ template, form, bindings: { born: 'born' }, format: { country: { display: 'name' } } })
    expect(names).toEqual([expect.objectContaining({ field: 'born', reason: 'overflow', severity: 'error' })])
    expect(await checkPdfBindingFit({ template, form, bindings: { born: 'born' } })).toEqual([])
  })

  it('counts every subdivision code against comb boxes', async () => {
    const template = acroFieldsPdf([{ name: 'state', rect: [0, 0, 200, 14], flags: COMB, maxLen: 2 }])
    expect(await checkPdfBindingFit({ template, form, bindings: { state: { path: 'state', format: { region: { display: 'code' } } } } })).toEqual([])
    expect(await checkPdfBindingFit({ template, form, bindings: { state: 'state' } }))
      .toEqual([expect.objectContaining({ field: 'state', reason: 'comb-length', severity: 'error' })])
  })

  it('checks an address member only when a format prints it', async () => {
    const template = acroFieldsPdf([{ name: 'country', rect: [0, 0, 70, 14] }])
    expect(await checkPdfBindingFit({ template, form, bindings: { country: 'home.country' } })).toEqual([])
    expect(await checkPdfBindingFit({ template, form, bindings: { country: 'home.country' }, format: { country: { display: 'name' } } }))
      .toEqual([expect.objectContaining({ field: 'country', reason: 'overflow' })])
  })
})

describe('the regions provider', () => {
  const bare = createFormatter()

  it('is needed to print a subdivision, and named when it is missing', () => {
    const fields = { state: data.fields.state }
    expect(() => renderText({ template: '{{fields.state}}', form, data: { fields }, format: { region: { display: 'name' } }, formatter: bare }))
      .toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: 'missing_format_provider', message: expect.stringContaining('@asterdoc/format/regions') })] }))
    const provided = createFormatter({ providers: { regions: regionsProvider } })
    expect(renderText({ template: '{{fields.state}}', form, data: { fields }, format: { region: { display: 'name' } }, formatter: provided })).toBe('California')
  })

  it('is not needed for a stored country code or for values without a place format', () => {
    expect(renderText({ template: '{{fields.born}}', form, data: { fields: { born: 'DE' } }, format: { country: { display: 'name' } }, formatter: bare })).toBe('Germany')
    expect(renderText({ template: '{{fields.state}}', form, data: { fields: { state: 'US-CA' } }, formatter: bare })).toBe('US-CA')
  })
})
