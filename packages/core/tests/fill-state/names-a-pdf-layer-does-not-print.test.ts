import { describe, test, expect } from 'vitest'
import { form, printedPartyMembers } from '@/index'
import { pdfFiles } from '../support/pdf-files'

const BOXES_OF_EVERY_TEST = ['family', 'given', 'middle', 'title', 'company', 'box', 'payee', 'first', 'second']
const SPLIT_NAME = { family: 'parties.client.lastName', given: 'parties.client.firstName', middle: 'parties.client.middleName' }

const definition = (layers: Record<string, unknown>, parties: Record<string, unknown> = { client: { label: 'Client', partyType: 'person', min: 1, max: 1 } }) => ({
	kind: 'form' as const,
	name: 'appearance',
	version: '1.0.0',
	title: 'Notice of appearance',
	fields: { matter: { type: 'text' as const, label: 'Matter' } },
	parties,
	layers,
	defaultLayer: Object.keys(layers)[0],
})

const pdf = (bindings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindings, ...extra })

const draftOf = async (layers: Record<string, unknown>, parties: Record<string, unknown>, roles?: Record<string, unknown>) =>
	(await form.load(definition(layers, roles) as never, { resolver: pdfFiles({}, BOXES_OF_EVERY_TEST) })).fill({ fields: {}, parties } as never)

const MESSAGE = 'The "pdf" layer prints this party\'s name from lastName, firstName and middleName, and the party gives none of them. Its name would not print. Give them next to name.'

describe('a party that gives only a full name, on a PDF layer that prints the name in parts', () => {
	test('is listed with the layer and the members the layer prints', async () => {
		const state = (await draftOf({ pdf: pdf(SPLIT_NAME) }, { client: { name: 'Elena Marisol Quintero' } })).getFillState()
		expect(state.unprintedNames).toEqual([{ role: 'client', index: 0, listed: false, layer: 'pdf', members: ['lastName', 'firstName', 'middleName'] }])
	})

	test('is accepted by fill and refused by validate, with the path of the party', async () => {
		const filled = (await form.load(definition({ pdf: pdf(SPLIT_NAME) }) as never, { resolver: pdfFiles({}, BOXES_OF_EVERY_TEST) })).safeFill({ fields: {}, parties: { client: { name: 'Elena Marisol Quintero' } } } as never)
		expect(filled.success).toBe(true)
		const draft = await draftOf({ pdf: pdf(SPLIT_NAME) }, { client: { name: 'Elena Marisol Quintero' } })
		expect((await draft).isValid()).toBe(false)
		expect((await draft).validate().errors).toEqual([{ field: 'parties.client', message: MESSAGE }])
	})

	test('makes the fill batch incomplete and names the problem', async () => {
		const batch = (await draftOf({ pdf: pdf(SPLIT_NAME) }, { client: { name: 'Elena Marisol Quintero' } })).getFillBatch()
		expect(batch.complete).toBe(false)
		expect(batch.unprintedNames).toEqual([{ path: 'parties.client', message: MESSAGE }])
	})

	test('is found through a template binding and through bindingsFrom', async () => {
		const template = { box: { template: '{{parties.client.lastName}}, {{parties.client.firstName}}' } }
		expect((await draftOf({ pdf: pdf(template) }, { client: { name: 'Elena Quintero' } })).getFillState().unprintedNames.map((entry) => entry.members)).toEqual([['lastName', 'firstName']])
		const layers = { pdf: pdf(SPLIT_NAME), copy: { kind: 'file' as const, mimeType: 'application/pdf', path: 'copy.pdf', bindingsFrom: 'pdf' } }
		expect((await draftOf(layers, { client: { name: 'Elena Quintero' } })).getFillState().unprintedNames.map((entry) => entry.layer)).toEqual(['pdf', 'copy'])
	})

	test('is found for the party at the index a binding names, in a role that holds several parties', async () => {
		const roles = { tenant: { label: 'Tenant', partyType: 'person', min: 1, max: 2 } }
		const layers = { pdf: pdf({ first: 'parties.tenant[0].lastName', second: 'parties.tenant[1].lastName' }) }
		const draft = await draftOf(layers, { tenant: [{ name: 'Ada Lovelace', lastName: 'Lovelace' }, { name: 'Grace Hopper' }] }, roles)
		expect((await draft).getFillState().unprintedNames).toEqual([{ role: 'tenant', index: 1, listed: true, layer: 'pdf', members: ['lastName'] }])
		expect((await draft).validate().errors).toEqual([
			{ field: 'parties.tenant[1]', message: 'The "pdf" layer prints this party\'s name from lastName, and the party gives no value for it. Its name would not print. Give it next to name.' },
		])
	})
})

describe('a party whose name prints', () => {
	test('gives at least one of the name parts the layer prints', async () => {
		const draft = await draftOf({ pdf: pdf(SPLIT_NAME) }, { client: { name: 'Elena Quintero', firstName: 'Elena', lastName: 'Quintero' } })
		expect((await draft).getFillState().unprintedNames).toEqual([])
		expect((await draft).getFillBatch().complete).toBe(true)
		expect((await draft).isValid()).toBe(true)
	})

	test('gives only a full name, on a layer that prints the full name', async () => {
		const draft = await draftOf({ pdf: pdf({ box: 'parties.client.name' }) }, { client: { name: 'Elena Quintero' } })
		expect((await draft).getFillState().unprintedNames).toEqual([])
		expect((await draft).isValid()).toBe(true)
	})

	test('has no title, on a layer that prints the full name and the title', async () => {
		const draft = await draftOf({ pdf: pdf({ box: 'parties.client.name', title: 'parties.client.title' }) }, { client: { name: 'Elena Quintero' } })
		expect((await draft).getFillState().unprintedNames).toEqual([])
		expect((await draft).isValid()).toBe(true)
	})

	test('is on a form with no PDF layer', async () => {
		const text = { markdown: { kind: 'inline' as const, mimeType: 'text/markdown', text: '{{parties.client.firstName}}' } }
		expect((await draftOf(text, { client: { name: 'Elena Quintero' } })).getFillState().unprintedNames).toEqual([])
	})
})

describe('a party that can be a person or an organization, on a PDF layer that prints the name parts and the legal name', () => {
	const EITHER = { petitioner: { label: 'Petitioner', partyType: 'any', min: 1, max: 1 } }
	const BOXES = { family: 'parties.petitioner.lastName', given: 'parties.petitioner.firstName', company: 'parties.petitioner.legalName' }
	const NONE = 'The "pdf" layer prints this party\'s name from lastName, firstName and legalName, and the party gives none of them. Its name would not print. Give them next to name.'

	test('prints an organization that gives its legal name', async () => {
		const draft = await draftOf({ pdf: pdf(BOXES) }, { petitioner: { name: 'Larkmoor Foods', legalName: 'Larkmoor Foods LLC' } }, EITHER)
		expect((await draft).getFillState().unprintedNames).toEqual([])
		expect((await draft).getFillBatch().complete).toBe(true)
		expect((await draft).isValid()).toBe(true)
	})

	test('prints a person who gives the name parts', async () => {
		const draft = await draftOf({ pdf: pdf(BOXES) }, { petitioner: { name: 'Elena Quintero', firstName: 'Elena', lastName: 'Quintero' } }, EITHER)
		expect((await draft).getFillState().unprintedNames).toEqual([])
		expect((await draft).isValid()).toBe(true)
	})

	test('refuses a party that gives only a full name', async () => {
		const draft = await draftOf({ pdf: pdf(BOXES) }, { petitioner: { name: 'Larkmoor Foods' } }, EITHER)
		expect((await draft).validate().errors).toEqual([{ field: 'parties.petitioner', message: NONE }])
	})

	test('refuses an organization that gives no legal name', async () => {
		const draft = await draftOf({ pdf: pdf(BOXES) }, { petitioner: { name: 'Larkmoor Foods', taxId: '49-3306157' } }, EITHER)
		expect((await draft).getFillState().unprintedNames).toEqual([{ role: 'petitioner', index: 0, listed: false, layer: 'pdf', members: ['lastName', 'firstName', 'legalName'] }])
		expect((await draft).isValid()).toBe(false)
	})
})

describe('an organization on a PDF layer that prints only the legal name', () => {
	const COMPANY = { payee: { label: 'Payee', partyType: 'organization', min: 1, max: 1 } }
	const BOX = { payee: 'parties.payee.legalName' }

	test('is refused when it gives a name and no legal name', async () => {
		const draft = await draftOf({ pdf: pdf(BOX) }, { payee: { name: 'Larkmoor Foods', taxId: '49-3306157' } }, COMPANY)
		expect((await draft).validate().errors).toEqual([
			{ field: 'parties.payee', message: 'The "pdf" layer prints this party\'s name from legalName, and the party gives no value for it. Its name would not print. Give it next to name.' },
		])
	})

	test('is accepted when it gives the legal name', async () => {
		const draft = await draftOf({ pdf: pdf(BOX) }, { payee: { name: 'Larkmoor Foods', legalName: 'Larkmoor Foods LLC' } }, COMPANY)
		expect((await draft).getFillState().unprintedNames).toEqual([])
		expect((await draft).isValid()).toBe(true)
	})
})

describe('the members of a party that a PDF layer prints', () => {
	test('are listed on the open party target of a fill batch, in binding order', async () => {
		const batch = (await form.load(definition({ pdf: pdf({ ...SPLIT_NAME, title: 'parties.client.title' }) }) as never, { resolver: pdfFiles({}, BOXES_OF_EVERY_TEST) })).fill({ fields: {} } as never).getFillBatch()
		expect(batch.open.find((target) => target.key === 'client')?.prints).toEqual(['lastName', 'firstName', 'middleName', 'title'])
	})

	test('are none for a layer whose bindings cannot be read', () => {
		const joined = definition({ pdf: pdf({ box: 'parties.client.lastName, parties.client.firstName' }) })
		expect(printedPartyMembers(joined as never, 'client')).toEqual([])
		const unknownSource = definition({ pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindingsFrom: 'missing' } })
		expect(printedPartyMembers(unknownSource as never, 'client')).toEqual([])
	})

	test('are absent when no PDF layer prints the party', async () => {
		const artifact = definition({ pdf: pdf({ box: 'fields.matter' }) })
		expect(printedPartyMembers(artifact as never, 'client')).toEqual([])
		const batch = (await form.load(artifact as never, { resolver: pdfFiles({}, BOXES_OF_EVERY_TEST) })).fill({ fields: {} } as never).getFillBatch()
		expect(batch.open.find((target) => target.key === 'client')).not.toHaveProperty('prints')
	})
})
