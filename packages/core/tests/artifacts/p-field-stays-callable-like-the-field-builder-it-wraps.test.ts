/**
 * core-015: `a.field` spread `field` into a plain object literal and then
 * listed 24 of its members again, which dropped `field`'s own callable form.
 *
 * Expected: `a.field` behaves exactly like the `field` builder it re-exports
 * — both callable directly and with its named members (e.g. `a.field.text`).
 */
import { describe, test, expect } from 'vitest'
import { a } from '@/artifacts'

describe('a.field stays callable, like the field builder it wraps', () => {
	test('a.field.text still works (a member)', () => {
		expect(() => a.field.text().label('x')).not.toThrow()
	})

	test('a.field(...) is callable directly', () => {
		expect(() => (a.field as unknown as (...args: unknown[]) => unknown)()).not.toThrow()
	})
})
