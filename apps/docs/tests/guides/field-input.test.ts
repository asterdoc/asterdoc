/**
 * Tests for code snippets in guides/field-input.mdx
 */
import { describe, test, expect } from 'vitest'
import { a, createAsterdocRuntime, fieldInputGuidance, placeDisplayNames, validate } from '@asterdoc/sdk'

const form = a.form({
  name: 'codes-and-masks',
  fields: {
    birthCountry: { type: 'country', label: 'Country of birth' },
    state: { type: 'region', label: 'State', country: 'US' },
    provinceOfBirth: { type: 'region', label: 'Province of birth' },
    homeAddress: { type: 'address', label: 'Home address', codes: true },
    plainAddress: { type: 'address', label: 'Mailing address' },
    ssn: { type: 'text', label: 'SSN', mask: '###-##-####' },
    aNumber: { type: 'text', label: 'A-Number', mask: 'A-#########' },
  },
})

const accepted = (fieldPath: string, value: unknown, options: { locale?: string; input?: 'canonical' | 'formatted' } = {}) => {
  const result = form.validateFieldInput({ fieldPath, value, ...options })
  if (!result.success) throw new Error(JSON.stringify(result.errors))
  return result.value
}

const refused = (fieldPath: string, value: unknown) => {
  const result = form.validateFieldInput({ fieldPath, value })
  if (result.success) throw new Error(`accepted ${JSON.stringify(result.value)}`)
  return result.errors[0]
}

describe('Codes and masks guide', () => {
  describe('countries', () => {
    test('codes, alpha-3 codes and names store the alpha-2 code', () => {
      expect(accepted('birthCountry', 'CA')).toBe('CA')
      expect(accepted('birthCountry', 'CAN')).toBe('CA')
      expect(accepted('birthCountry', 'canada')).toBe('CA')
    })

    test('a name in the input locale is accepted', () => {
      expect(form.validateFieldInput({ fieldPath: 'birthCountry', value: 'Allemagne', locale: 'fr-FR' })).toEqual({ success: true, value: 'DE', errors: null })
    })

    test('a former code is refused', () => {
      expect(refused('birthCountry', 'YU')?.code).toBe('unknown_country')
    })

    test('Georgia is ambiguous, with both candidates', () => {
      expect(form.validateFieldInput({ fieldPath: 'birthCountry', value: 'Georgia' })).toEqual({
        success: false,
        value: null,
        errors: [{
          field: 'fields.birthCountry',
          message: '"Georgia" names a country and a subdivision of another country.',
          code: 'ambiguous_country',
          candidates: [{ code: 'GE', name: 'Georgia' }, { code: 'US-GA', name: 'Georgia, United States' }],
        }],
      })
    })

    test('Mexico is not ambiguous', () => {
      expect(accepted('birthCountry', 'Mexico')).toBe('MX')
    })

    test('no match offers up to five nearest candidates', () => {
      const error = refused('birthCountry', 'Narnia')
      expect(error?.code).toBe('unknown_country')
      expect(error?.candidates).toHaveLength(5)
    })
  })

  describe('regions', () => {
    test('a region field stores the full code from a name, a full code, or a short code with country', () => {
      expect(accepted('state', 'California')).toBe('US-CA')
      expect(accepted('state', 'US-CA')).toBe('US-CA')
      expect(accepted('state', 'CA')).toBe('US-CA')
    })

    test('the country constraint refuses another country with candidates', () => {
      const error = refused('state', 'Ontario')
      expect(error?.code).toBe('unknown_region')
      expect(error?.candidates?.length).toBeGreaterThan(0)
    })

    test('a short code without country needs a country', () => {
      expect(refused('provinceOfBirth', 'ON')?.code).toBe('needs_country')
      expect(accepted('provinceOfBirth', 'Ontario')).toBe('CA-ON')
    })
  })

  describe('coded addresses', () => {
    const draft = form.fill({})
    const filled = draft.update({
      fields: { homeAddress: { line1: '1 Rue Exemple', locality: 'Montréal', region: 'Québec', postalCode: 'H2X 1Y4', country: 'Canada' } },
    })

    test('country and region store as codes', () => {
      expect(filled.fields.homeAddress).toEqual({ line1: '1 Rue Exemple', locality: 'Montréal', region: 'QC', postalCode: 'H2X 1Y4', country: 'CA' })
    })

    test('a patch is read in the stored country', () => {
      const moved = filled.update({ fields: { homeAddress: { region: 'Ontario' } } })
      expect(moved.fields.homeAddress).toMatchObject({ region: 'ON', country: 'CA' })
    })

    test('without codes the address stores what it is given', () => {
      const plain = draft.update({ fields: { plainAddress: { line1: '1 Rue Exemple', locality: 'Montréal', region: 'Québec', postalCode: 'H2X 1Y4', country: 'Canada' } } })
      expect(plain.fields.plainAddress).toMatchObject({ region: 'Québec', country: 'Canada' })
    })
  })

  describe('masks', () => {
    test('canonical and formatted input store the same value', () => {
      expect(accepted('ssn', '123-45-6789')).toBe('123456789')
      expect(accepted('ssn', '123456789')).toBe('123456789')
      expect(accepted('aNumber', 'A-123456789')).toBe('123456789')
    })

    test('a partial value is read in the stated form', () => {
      expect(accepted('ssn', '12345')).toBe('12345')
      expect(accepted('ssn', '123-45', { input: 'formatted' })).toBe('12345')
      expect(refused('ssn', '123-45')?.code).toBe('mask_mismatch')
    })

    test('an incomplete value is mask_mismatch at validate and at render, and a placeholder in a progressive preview', async () => {
      const masked = a.form({
        name: 'masked',
        fields: { ssn: { type: 'text', label: 'SSN', mask: '###-##-####' } },
        layers: { text: { kind: 'inline', mimeType: 'text/plain', text: '[{{ fields.ssn }}]' } },
      })
      const draft = masked.fill({ fields: { ssn: '12345' } })
      expect(draft.validate().errors.map((error) => error.code)).toEqual(['mask_mismatch'])
      await expect(draft.render({ layer: 'text' })).rejects.toMatchObject({ name: 'ArtifactFieldFormatError', issues: [{ code: 'mask_mismatch' }] })
      expect(await draft.render({ layer: 'text', progressive: {} })).toBe('[…]')
    })

    test('a country default must be the code', () => {
      expect(() => a.form({ name: 'bad-default', fields: { country: { type: 'country', label: 'Country', default: 'Canada' } } })).toThrow()
      expect(a.form({ name: 'good-default', fields: { country: { type: 'country', label: 'Country', default: 'CA' } } }).fill({}).fields.country).toBe('CA')
    })

    test('a masked default is accepted in either form and stored canonical', () => {
      const definition = (value: string) => ({
        $schema: 'https://schema.asterdoc.com/2026-11-10.json',
        kind: 'form' as const,
        name: 'masked-default',
        version: '1.0.0',
        fields: { ssn: { type: 'text' as const, label: 'SSN', mask: '###-##-####', default: value } },
      })
      expect(a.form(definition('123-45-6789')).fill({}).fields.ssn).toBe('123456789')
      expect(a.form(definition('123456789')).fill({}).fields.ssn).toBe('123456789')
      expect(validate(definition('12-345')).issues?.[0]?.message).toContain('has a default that does not fit its mask')
      expect(() => a.form(definition('12-345')).fill({})).toThrow('has a default that does not fit its mask')
    })
  })

  describe('conversational input', () => {
    test('fieldInputGuidance describes a masked field', () => {
      expect(fieldInputGuidance({ type: 'text', label: 'SSN', mask: '###-##-####' })).toBe(
        'Accepts the value with or without its separators (###-##-####: 9 digits, written 123-45-6789 or 123456789); it is stored without them',
      )
    })

    test('fieldInputGuidance is undefined for a field that stores input as given', () => {
      expect(fieldInputGuidance({ type: 'text', label: 'Note' })).toBeUndefined()
    })

    test('placeDisplayNames gives words for stored codes', () => {
      expect(placeDisplayNames(form.fields, { homeAddress: { region: 'ON', country: 'CA' }, state: 'US-CA' })).toEqual({
        'fields.homeAddress.country': 'Canada',
        'fields.homeAddress.region': 'Ontario, Canada',
        'fields.state': 'California, United States',
      })
    })

    test('a session runtime keeps the code and candidates of a refusal', () => {
      const runtime = createAsterdocRuntime(form.toJSON(), { locale: 'fr-FR' })
      expect(runtime.validateField('birthCountry', 'Allemagne')).toEqual({ ok: true, value: 'DE' })
      const refusal = runtime.validateField('birthCountry', 'Georgia')
      expect(refusal.ok).toBe(false)
      expect(refusal.ok ? undefined : refusal.issues[0]).toMatchObject({ code: 'ambiguous_country' })
    })
  })
})
