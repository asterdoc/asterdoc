import { describe, expect, test } from 'vitest'
import { form } from '@/artifacts'
import type { FillBatch } from '@/fill-state'

const appearance = () =>
	form({
		kind: 'form',
		name: 'appearance',
		version: '1.0.0',
		fields: {
			isAttorney: { type: 'boolean', label: 'Is an attorney', required: true },
			name: { type: 'text', label: 'Full name', description: 'Part 1, Item 2', required: true },
			officeAddress: { type: 'address', label: 'Office address' },
			yearsInPractice: { type: 'number', label: 'Years in practice', min: 0, max: 70, step: 1 },
			admittedOn: { type: 'date', label: 'Date admitted', max: '2026-12-31' },
			initials: { type: 'text', label: 'Initials', minLength: 2, maxLength: 3, pattern: '^[A-Z]+$' },
			status: {
				type: 'enum',
				label: 'Subject to a restricting order',
				required: true,
				enum: [
					{ value: 'am_not', label: 'Am not subject' },
					{ value: 'am', label: 'Am subject' },
				],
			},
			barNumber: { type: 'text', label: 'Bar number', visible: 'fields.isAttorney == true', required: 'fields.isAttorney == true' },
			licensingState: {
				type: 'enum',
				label: 'Licensing state',
				visible: 'fields.isAttorney == true',
				required: 'fields.isAttorney == true',
				enum: [{ value: 'CA', label: 'California' }, { value: 'OH', label: 'Ohio' }],
			},
			orderDetails: { type: 'text', label: 'Order details', visible: 'fields.status == "am"', required: 'fields.status == "am"' },
			stateBarSection: { type: 'text', label: 'State bar section', visible: 'fields.licensingState == "CA"', required: 'fields.licensingState == "CA"' },
		},
		parties: {
			client: { label: 'Client', partyType: 'person', min: 1, max: 1 },
		},
		rules: {
			realName: { expr: 'fields.name != "Nobody"', severity: 'error', message: 'Give a real name' },
		},
	} as any)

const keys = (batch: FillBatch) => batch.open.map((target) => target.key)
const level0 = { isAttorney: true, name: 'Nadia Calloway', status: 'am' }

describe('fillBatch', () => {
	test('the first batch holds every target open with no data, required first, and counts what waits behind them', () => {
		const batch = appearance().fill().getFillBatch()
		expect(keys(batch)).toEqual(['client', 'isAttorney', 'name', 'status', 'officeAddress', 'yearsInPractice', 'admittedOn', 'initials'])
		expect(batch.open.filter((target) => target.required).map((target) => target.key)).toEqual(['client', 'isAttorney', 'name', 'status'])
		expect(batch.waiting.count).toBe(4)
		expect(batch.waiting.on.sort()).toEqual(['isAttorney', 'status'])
		expect(batch.complete).toBe(false)
	})

	test('describes how to write each value: label, description, type, options, composite shape and party shape', () => {
		const batch = appearance().fill().getFillBatch()
		const target = (key: string) => batch.open.find((entry) => entry.key === key)!
		expect(target('name')).toMatchObject({ kind: 'field', type: 'text', label: 'Full name', description: 'Part 1, Item 2', required: true })
		expect(target('status').options).toEqual([
			{ value: 'am_not', label: 'Am not subject' },
			{ value: 'am', label: 'Am subject' },
		])
		expect(target('officeAddress')).toMatchObject({ type: 'address', required: false })
		expect(target('officeAddress').shape).toMatch(/^address: \{.*line1.*postalCode.*\}$/)
		expect(target('client')).toMatchObject({ kind: 'party', type: 'person', label: 'Client', required: true })
		expect(target('client').shape).toMatch(/^person: \{.*name.*\}$/)
		expect(target('isAttorney').shape).toBeUndefined()
	})

	test('gives the limits and formats a value must keep, so text can be matched to the right field', () => {
		const batch = appearance().fill().getFillBatch()
		const target = (key: string) => batch.open.find((entry) => entry.key === key)!
		expect(target('yearsInPractice')).toMatchObject({ type: 'number', constraints: { min: 0, max: 70, step: 1 } })
		expect(target('admittedOn')).toMatchObject({ type: 'date', format: 'YYYY-MM-DD', constraints: { max: '2026-12-31' } })
		expect(target('initials').constraints).toEqual({ minLength: 2, maxLength: 3, pattern: '^[A-Z]+$' })
		expect(target('name').constraints).toBeUndefined()
		expect(target('name').format).toBeUndefined()
	})

	test('the next batch opens the targets that the first answers made visible, and only those', () => {
		const batch = appearance().fill({ fields: level0, parties: { client: { name: 'Elena Quintero' } } } as any).getFillBatch()
		expect(keys(batch)).toEqual(['barNumber', 'licensingState', 'orderDetails', 'officeAddress', 'yearsInPractice', 'admittedOn', 'initials'])
		expect(batch.waiting).toEqual({ count: 1, on: ['licensingState'] })
	})

	test('a target two levels down opens only after the answer it depends on', () => {
		const batch = appearance()
			.fill({ fields: { ...level0, barNumber: '0094127', licensingState: 'CA', orderDetails: 'Suspended 2019' }, parties: { client: { name: 'Elena Quintero' } } } as any)
			.getFillBatch()
		expect(keys(batch)).toEqual(['stateBarSection', 'officeAddress', 'yearsInPractice', 'admittedOn', 'initials'])
		expect(batch.waiting.count).toBe(0)
	})

	test('an answer that keeps a branch closed never opens it', () => {
		const batch = appearance()
			.fill({ fields: { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }, parties: { client: { name: 'Elena Quintero' } } } as any)
			.getFillBatch()
		expect(keys(batch)).toEqual(['officeAddress', 'yearsInPractice', 'admittedOn', 'initials'])
		expect(batch.waiting.count).toBe(4)
		expect(batch.waiting.on).toEqual([])
		expect(batch.complete).toBe(true)
	})

	test('is complete only when no required target is open and every rule passes', () => {
		const done = { fields: { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }, parties: { client: { name: 'Elena Quintero' } } }
		expect(appearance().fill(done as any).getFillBatch().complete).toBe(true)
		const failing = appearance().fill({ ...done, fields: { ...done.fields, name: 'Nobody' } } as any).getFillBatch()
		expect(failing.complete).toBe(false)
		expect(failing.rules.errors).toEqual([expect.objectContaining({ ruleId: 'realName', message: 'Give a real name' })])
		expect(appearance().fill({ fields: { name: 'Nadia Calloway' } } as any).getFillBatch().complete).toBe(false)
	})

	test('marks a target that a condition opened, and a field inside a fieldset that a condition opened, and no other target', () => {
		const firm = form({
			kind: 'form',
			name: 'firm',
			version: '1.0.0',
			fields: {
				hasFirm: { type: 'boolean', label: 'Works at a firm' },
				firm: {
					type: 'fieldset',
					label: 'Firm',
					visible: 'fields.hasFirm == true',
					fields: { name: { type: 'text', label: 'Firm name' } },
				},
				office: { type: 'fieldset', label: 'Office', fields: { city: { type: 'text', label: 'City' } } },
				alwaysShown: { type: 'text', label: 'Shown', visible: true },
			},
		} as any)
		const batch = firm.fill({ fields: { hasFirm: true } } as any).getFillBatch()
		const conditional = Object.fromEntries(batch.open.map((target) => [target.key, target.conditional === true]))
		expect(conditional).toMatchObject({ 'firm.name': true, 'office.city': false, alwaysShown: false })
		expect(appearance().fill({ fields: level0 } as any).getFillBatch().open.filter((target) => target.conditional).map((target) => target.key)).toEqual(['barNumber', 'licensingState', 'orderDetails'])
	})

	test('says that a role with room for more than one party takes a list, and says nothing of it for a role with one party', () => {
		const lease = form({
			kind: 'form',
			name: 'lease',
			version: '1.0.0',
			fields: { rent: { type: 'number', label: 'Rent' } },
			parties: {
				landlord: { label: 'Landlord', partyType: 'person', min: 1, max: 1 },
				tenants: { label: 'Tenants', partyType: 'person', min: 1, max: 4 },
			},
		} as any)
		const batch = lease.fill().getFillBatch()
		const target = (key: string) => batch.open.find((entry) => entry.key === key)!
		expect(target('tenants')).toMatchObject({ kind: 'party', item: 'person', constraints: { maxItems: 4 } })
		expect(target('landlord').item).toBeUndefined()
		expect(target('landlord').constraints).toBeUndefined()
	})

	test('says how to write the number of a phone', () => {
		const contact = form({ kind: 'form', name: 'contact', version: '1.0.0', fields: { phone: { type: 'phone', label: 'Telephone' }, email: { type: 'email', label: 'Email' } } } as any)
		const batch = contact.fill().getFillBatch()
		const target = (key: string) => batch.open.find((entry) => entry.key === key)!
		expect(target('phone').input).toContain('+, the country code, the national number (+12154852665)')
		expect(target('email').input).toBeUndefined()
	})

	test('names the fields of each row of a list whose rows are objects, and names none for a list of plain values', () => {
		const family = form({
			kind: 'form',
			name: 'family',
			version: '1.0.0',
			fields: {
				children: {
					type: 'list',
					label: 'Children',
					maxItems: 2,
					item: {
						type: 'fieldset',
						fields: {
							familyName: { type: 'text', label: 'Family name', required: true, maxLength: 47 },
							relation: { type: 'enum', label: 'Relation', enum: [{ value: 'child', label: 'Child' }, { value: 'stepchild', label: 'Stepchild' }] },
							born: { type: 'date', label: 'Date of birth' },
							birthplace: { type: 'fieldset', fields: { city: { type: 'text', label: 'City of birth' } } },
							school: { type: 'text', label: 'School', visible: 'fields.inSchool == true' },
						},
					},
				},
				nicknames: { type: 'list', label: 'Nicknames', item: { type: 'text' } },
				inSchool: { type: 'boolean', label: 'A child is in school' },
			},
		} as any)
		const batch = family.fill().getFillBatch()
		const target = (key: string) => batch.open.find((entry) => entry.key === key)!
		expect(target('children').item).toBe('fieldset')
		expect(target('children').rows).toEqual([
			{ kind: 'field', key: 'familyName', required: true, type: 'text', label: 'Family name', constraints: { maxLength: 47 } },
			{ kind: 'field', key: 'relation', required: false, type: 'enum', label: 'Relation', options: [{ value: 'child', label: 'Child' }, { value: 'stepchild', label: 'Stepchild' }] },
			{ kind: 'field', key: 'born', required: false, type: 'date', label: 'Date of birth', format: 'YYYY-MM-DD' },
			{ kind: 'field', key: 'birthplace.city', required: false, type: 'text', label: 'City of birth' },
			{ kind: 'field', key: 'school', required: false, conditional: true, type: 'text', label: 'School' },
		])
		expect(target('nicknames').item).toBe('text')
		expect(target('nicknames').rows).toBeUndefined()
	})
})
