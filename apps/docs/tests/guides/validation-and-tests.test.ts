/**
 * Tests for code snippets in guides/validation-and-tests.mdx
 */
import { describe, test, expect } from 'vitest'
import { a, validate } from '@asterdoc/sdk'

const definition = {
  $schema: 'https://schema.asterdoc.com/2026-11-10.json',
  kind: 'form' as const,
  name: 'direct-deposit',
  version: '1.0.0',
  fields: {
    routingNumber: { type: 'text' as const, label: 'Routing number' },
    accountNumber: { type: 'text' as const, label: 'Account number', sensitive: true },
    card: { type: 'text' as const, label: 'Card' },
  },
  rules: {
    routingChecksum: { expr: 'weightedMod(fields.routingNumber, [3, 7, 1], 10) == 0', message: 'Enter a valid routing number', paths: ['fields.routingNumber'] },
    accountLength: { expr: 'length(fields.accountNumber) >= 4', message: 'Account number is too short', paths: ['fields.accountNumber'] },
    cardLuhn: { expr: "checkDigit(fields.card, 'luhn')", message: 'Check the card number', severity: 'warning' as const },
  },
  layers: { summary: { kind: 'inline' as const, mimeType: 'text/plain', text: '{{ fields.routingNumber }}' } },
  tests: [
    {
      name: 'a valid routing number passes',
      input: { fields: { routingNumber: '011000015', accountNumber: '00001234', card: '4111111111111111' } },
      expect: { valid: true },
    },
    {
      name: 'a bad check digit fails',
      input: { fields: { routingNumber: '123456789', accountNumber: '00001234', card: '4111111111111112' } },
      expect: { valid: false, failures: ['routingChecksum', 'cardLuhn'] },
    },
  ],
}

const form = a.form(definition)
const draft = form.fill({ fields: { routingNumber: '123456789', accountNumber: '12', card: '4111111111111112' } })

describe('Rules and test cases guide', () => {
  describe('rules', () => {
    test('a failed rule reports its id, paths and the values it read', () => {
      expect(draft.validate().rules.errors[0]).toEqual({
        ruleId: 'routingChecksum',
        passed: false,
        message: 'Enter a valid routing number',
        severity: 'error',
        paths: ['fields.routingNumber'],
        explanation: { values: [{ path: 'fields.routingNumber', value: '"123456789"' }] },
      })
    })

    test('a list value prints at most ten elements', () => {
      const listed = a.form({
        name: 'listed',
        fields: { codes: { type: 'list', label: 'Codes', item: { type: 'text', label: 'Code' } } },
        rules: { few: { expr: 'count(fields.codes) <= 3', message: 'Too many codes' } },
      })
      const codes = Array.from({ length: 12 }, (_, index) => `C${index + 1}`)
      const value = listed.fill({ fields: { codes } }).validate().rules.errors[0]?.explanation?.values[0]?.value
      expect(value).toBe(`[${codes.slice(0, 10).map((code) => JSON.stringify(code)).join(', ')}, … 2 more]`)
    })

    test('a warning does not make the draft invalid', () => {
      const passing = form.fill({ fields: { routingNumber: '011000015', accountNumber: '00001234', card: '4111111111111112' } })
      const result = passing.validate()
      expect(result.valid).toBe(true)
      expect(result.rules.warnings.map((rule) => rule.ruleId)).toEqual(['cardLuhn'])
    })

    test('a path that names no field fails validation', () => {
      const result = validate({ ...definition, rules: { routingChecksum: { ...definition.rules.routingChecksum, paths: ['fields.routing'] } } })
      expect(result.issues?.length).toBeGreaterThan(0)
    })

    test('the ABA check accepts a published test routing number', () => {
      const valid = form.fill({ fields: { routingNumber: '011000015', accountNumber: '00001234', card: '4111111111111111' } })
      expect(valid.validate().valid).toBe(true)
    })
  })

  describe('sensitive values', () => {
    test('a sensitive value prints redacted with its kind and length', () => {
      expect(draft.validate().rules.errors[1]?.explanation).toEqual({ values: [{ path: 'fields.accountNumber', value: '[redacted] (string, length 2)' }] })
    })

    test('explain raw prints the value as it is', () => {
      expect(draft.validate({ explain: { raw: true } }).rules.errors[1]?.explanation).toEqual({ values: [{ path: 'fields.accountNumber', value: '"12"' }] })
    })

    test('an identification field is sensitive unless it opts out', () => {
      const ids = a.form({
        name: 'ids',
        fields: {
          passport: { type: 'identification', label: 'Passport' },
          badge: { type: 'identification', label: 'Badge', sensitive: false },
        },
        rules: {
          passportLength: { expr: 'length(fields.passport.number) > 5', message: 'Too short' },
          badgeLength: { expr: 'length(fields.badge.number) > 5', message: 'Too short' },
        },
      })
      const filled = ids.fill({ fields: { passport: { type: 'passport', number: 'X1' }, badge: { type: 'badge', number: 'B1' } } })
      const values = filled.validate().rules.errors.map((rule) => rule.explanation?.values[0]?.value)
      expect(values).toEqual(['[redacted] (string, length 2)', '"B1"'])
    })

    test('rendered output prints the value', async () => {
      const shown = a.form({ ...definition, layers: { summary: { kind: 'inline', mimeType: 'text/plain', text: '{{ fields.accountNumber }}' } } })
      expect(await shown.fill({ fields: { accountNumber: '00001234' } }).render({ layer: 'summary' })).toBe('00001234')
    })
  })

  describe('test cases', () => {
    test('runTests reports each case', () => {
      const report = form.runTests()
      expect(report.passed).toBe(true)
      expect(report.results[1]).toEqual({
        name: 'a bad check digit fails',
        passed: true,
        valid: false,
        failures: ['cardLuhn', 'routingChecksum'],
        errors: [],
        expected: { valid: false, failures: ['routingChecksum', 'cardLuhn'] },
        sensitiveInputs: ['fields.accountNumber'],
      })
    })

    test('a case whose outcome differs from expect fails', () => {
      const wrong = a.form({ ...definition, tests: [{ ...definition.tests[1]!, expect: { valid: true } }] })
      const report = wrong.runTests()
      expect(report.passed).toBe(false)
      expect(report.results[0]?.passed).toBe(false)
    })

    test('asOf makes a rule that reads today() deterministic', () => {
      const dated = a.form({
        name: 'dated',
        fields: { startDate: { type: 'date', label: 'Start date' } },
        rules: { startsInFuture: { expr: 'fields.startDate > today()', message: 'Start in the future' } },
        tests: [
          { name: 'a future start passes', input: { fields: { startDate: '2026-12-01' } }, context: { asOf: '2026-11-10T00:00:00Z' }, expect: { valid: true } },
          { name: 'a past start fails', input: { fields: { startDate: '2026-11-01' } }, context: { asOf: '2026-11-10T00:00:00Z' }, expect: { valid: false, failures: ['startsInFuture'] } },
        ],
      })
      expect(dated.runTests().passed).toBe(true)
    })
  })

  describe('rendering only complete forms', () => {
    test('require complete refuses a draft with a failed error rule', async () => {
      await expect(draft.render({ layer: 'summary', require: 'complete' })).rejects.toMatchObject({
        name: 'FormRuleViolationError',
        message: 'Form rules validation failed: Enter a valid routing number, Account number is too short',
      })
    })

    test('the default render draws the draft as it is', async () => {
      expect(await draft.render({ layer: 'summary' })).toBe('123456789')
    })

    test('warnings never block a complete render', async () => {
      const warned = form.fill({ fields: { routingNumber: '011000015', accountNumber: '00001234', card: '4111111111111112' } })
      expect(await warned.render({ layer: 'summary', require: 'complete' })).toBe('011000015')
    })
  })
})
