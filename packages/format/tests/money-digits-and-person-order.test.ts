import { describe, expect, it } from 'vitest'
import { createFormatter } from '../src/index'

const usd = (amount: number) => ({ amount, currency: 'USD' })

describe('money fractionDigits', () => {
	const formatter = createFormatter({ locale: 'en-US' })

	it('rounds half away from zero to the stated digits', () => {
		expect(formatter.formatMoney(usd(1.999), { fractionDigits: 0 })).toBe('$2')
		expect(formatter.formatMoney(usd(0.05), { fractionDigits: 0 })).toBe('$0')
		expect(formatter.formatMoney(usd(1234.5), { fractionDigits: 0 })).toBe('$1,235')
		expect(formatter.formatMoney(usd(1234.5), { fractionDigits: 0, currencyDisplay: 'none' })).toBe('1,235')
		expect(formatter.formatMoney(usd(7), { fractionDigits: 2, currencyDisplay: 'none' })).toBe('7.00')
		expect(formatter.formatMoney({ amount: 1234.5, currency: 'JPY' }, { fractionDigits: 2 })).toBe('¥1,234.50')
	})

	it('replaces fraction and significant digits set at a lower level', () => {
		const significant = createFormatter({ locale: 'en-US', money: { maximumSignificantDigits: 2, minimumFractionDigits: 3 } })
		expect(significant.formatMoney(usd(1234.5))).toBe('$1,200')
		expect(significant.formatMoney(usd(1234.5), { fractionDigits: 0 })).toBe('$1,235')
		expect(createFormatter({ locale: 'en-US', money: { fractionDigits: 0 } }).formatMoney(usd(9.5))).toBe('$10')
	})

	it('refuses a value that is not a whole number of digits', () => {
		expect(formatter.safeFormatMoney(usd(1), { fractionDigits: 1.5 })).toMatchObject({ success: false, status: 'invalid' })
		expect(formatter.safeFormatMoney(usd(1), { fractionDigits: -1 })).toMatchObject({ success: false, status: 'invalid' })
		expect(() => createFormatter({ money: { fractionDigits: 101 } })).toThrow('fractionDigits')
	})

	it('prints without grouping when useGrouping is false', () => {
		expect(formatter.formatMoney(usd(1234567.5), { useGrouping: false })).toBe('$1234567.50')
		expect(formatter.formatMoney(usd(1234567.5), { useGrouping: false, fractionDigits: 0, currencyDisplay: 'none' })).toBe('1234568')
		expect(formatter.formatMoney(usd(1234567.5))).toBe('$1,234,567.50')
	})
})

describe('person order', () => {
	const formatter = createFormatter({ locale: 'en-US' })
	const person = { name: 'Dr. Jane Q. Public Jr.', title: 'Dr.', firstName: 'Jane', middleName: 'Q.', lastName: 'Public', suffix: 'Jr.' }

	it('prints the structured parts last name first, without the title', () => {
		expect(formatter.formatPerson(person, { order: 'family-first' })).toBe('Public, Jane Q. Jr.')
		expect(formatter.formatPerson({ name: 'Jane Public', firstName: 'Jane', lastName: 'Public' }, { order: 'family-first' })).toBe('Public, Jane')
		expect(formatter.formatPerson({ name: 'Public', lastName: 'Public' }, { order: 'family-first' })).toBe('Public')
		expect(formatter.formatPerson({ name: 'Jane', firstName: 'Jane' }, { order: 'family-first' })).toBe('Jane')
	})

	it('prints the name as given when there are no parts to reorder, or the order is given-first', () => {
		expect(formatter.formatPerson({ name: 'Jane Public', title: 'Dr.' }, { order: 'family-first' })).toBe('Jane Public')
		expect(formatter.formatPerson(person, { order: 'given-first' })).toBe('Dr. Jane Q. Public Jr.')
		expect(formatter.formatPerson(person)).toBe('Dr. Jane Q. Public Jr.')
	})

	it('orders a person party, and leaves an organization party as it was', () => {
		expect(formatter.formatParty({ name: 'Jane Public', firstName: 'Jane', lastName: 'Public' }, { partyType: 'person', person: { order: 'family-first' } })).toBe('Public, Jane')
		expect(formatter.formatParty({ name: 'Acme', legalName: 'Acme Inc.' }, { partyType: 'organization', person: { order: 'family-first' } })).toBe('Acme (Legal name: Acme Inc.)')
	})

	it('refuses an order it does not know', () => {
		expect(formatter.safeFormatPerson(person, { order: 'surname' as never })).toMatchObject({ success: false, status: 'invalid' })
		expect(() => createFormatter({ party: { person: { order: 'surname' as never } } })).toThrow('Person order')
		expect(createFormatter().safeFormatParty(person, { partyType: 'person', person: { order: 'surname' as never } })).toMatchObject({ success: false, status: 'invalid' })
	})
})
