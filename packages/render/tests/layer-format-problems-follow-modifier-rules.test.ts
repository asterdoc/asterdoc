import { describe, expect, it } from 'vitest'
import type { LayerFormat } from '@asterdoc/types'
import { formatModifiers, formatProblem } from '../src'

const date = { kind: 'date' }
const money = { kind: 'money' }
const text = { kind: 'text' }

describe('a layer format checked by the template modifier rules', () => {
  it('flattens a format into its dotted modifier keys', () => {
    expect(formatModifiers({ locale: 'en-US', date: { pattern: 'MM/DD/YYYY' }, money: undefined }).map(({ key, value }) => [key, value]))
      .toEqual([['locale', 'en-US'], ['date.pattern', 'MM/DD/YYYY']])
  })

  it('accepts keys that apply to the value', () => {
    expect(formatProblem({ locale: 'en-US', date: { pattern: 'MM/DD/YYYY' } }, [date])).toBeUndefined()
  })

  it('refuses a key that applies to none of the values', () => {
    expect(formatProblem({ money: { currencyDisplay: 'none' } }, [date, text])).toBe('money.currencyDisplay applies to money values, not to a date value.')
  })

  it('accepts a key that applies to one value of several', () => {
    expect(formatProblem({ money: { currencyDisplay: 'none' }, date: { pattern: 'YYYY-MM-DD' } }, [text, money, date])).toBeUndefined()
  })

  it('refuses a value the key does not take, with or without targets', () => {
    expect(formatProblem({ locale: 'not a locale' }, [])).toMatch(/^locale takes a BCP 47 language tag/)
    expect(formatProblem({ date: { pattern: 'MM-DD' } } as unknown as LayerFormat, [date])).toMatch(/^date\.pattern takes/)
  })

  it('refuses a key no modifier rule knows', () => {
    expect(formatProblem({ colour: 'red' } as unknown as LayerFormat, [])).toMatch(/^Unknown format modifier "colour"/)
  })

  it('checks only keys and values when the values are unknown', () => {
    expect(formatProblem({ money: { currencyDisplay: 'none' } }, [])).toBeUndefined()
  })
})
