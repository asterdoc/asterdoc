import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { DraftFormJSON, Form, SealAdapter } from '@asterdoc/types'
import { form, runtimeFormFromJSON, type DraftForm } from '@/artifacts'
import { validateArtifact } from '@/validation'

const sealedPdf = new Uint8Array(readFileSync(join(__dirname, '..', 'artifacts', 'form', 'fixtures', 'one-field-form.pdf')))

function deliveryDefinition() {
	return form()
		.name('hidden-defaults')
		.fields({
			mode: { type: 'enum', enum: [{ value: 'short' }, { value: 'full' }], required: true },
			detail: { type: 'text', default: 'Standard', visible: "fields.mode == 'full'" },
			req: { type: 'text', default: 'R', required: true, visible: "fields.mode == 'full'" },
			express: { type: 'enum', enum: [{ value: 'yes' }, { value: 'no' }], default: 'yes', visible: "fields.mode == 'full'" },
			courier: { type: 'text', default: 'Fast Co', visible: "fields.express == 'yes'" },
			standard: { type: 'boolean', default: true, visible: "fields.mode == 'full'" },
			custom: { type: 'text', default: 'Own terms', visible: 'fields.standard != true' },
			extras: {
				type: 'fieldset',
				visible: "fields.mode == 'full'",
				fields: {
					tag: { type: 'text', default: 'T' },
					gift: { type: 'boolean', default: true },
				},
			},
			showNotes: { type: 'boolean' },
			rows: {
				type: 'list',
				item: {
					type: 'fieldset',
					fields: {
						label: { type: 'text', default: 'Row' },
						note: { type: 'text', default: 'None', visible: 'fields.showNotes == true' },
					},
				},
			},
		})
		.inlineLayer('default', {
			mimeType: 'text/plain',
			text: 'Mode {{fields.mode}}. Detail [{{fields.detail}}]. Req [{{fields.req}}]. Tag [{{fields.extras.tag}}]. Custom [{{fields.custom}}].',
		})
		.build()
}

async function deliveryForm() {
	return await form.load(deliveryDefinition())
}

async function signedDelivery() {
	const definition = { ...deliveryDefinition(), parties: { buyer: { label: 'Buyer', partyType: 'person', signature: { required: true } } } }
	return (await form.load(definition as never))
		.fill({})
		.setParty('buyer' as never, { name: 'Bea Buyer' } as never)
		.addSigner('bea', { person: { name: 'Bea Signer' } })
		.addSignatory('buyer' as never, 'buyer-0', { signerId: 'bea' })
}

const HIDDEN_DEFAULTS = ['detail', 'req', 'express', 'courier', 'standard', 'extras'] as const

describe('a default applies only to a field that applies, at every state of a draft', () => {
	test('a draft filled with every default visible drops them when an update hides their fields', async () => {
		const shown = (await deliveryForm()).fill({ fields: { mode: 'full' } })
		const hidden = shown.update({ fields: { mode: 'short' } })

		expect(shown.fields).toMatchObject({ detail: 'Standard', req: 'R', express: 'yes', courier: 'Fast Co', standard: true })
		expect(shown.givenFields).toEqual({ mode: 'full' })
		expect(hidden.givenFields).toEqual({ mode: 'short' })
		for (const id of HIDDEN_DEFAULTS) {
			expect(hidden.fields).not.toHaveProperty(id)
			expect(hidden.toJSON().fields).not.toHaveProperty(id)
		}
		expect(hidden.getFillState().notApplicable).toEqual([])
		expect(hidden.validate().errors).toEqual([])
		expect(await hidden.render()).toBe('Mode short. Detail []. Req []. Tag []. Custom [Own terms].')
	})

	test('a value the caller gives for a field that an update hides is still not applicable', async () => {
		const hidden = (await deliveryForm()).fill({ fields: { mode: 'full', detail: 'Given' } }).update({ fields: { mode: 'short' } })

		expect(hidden.fields).toHaveProperty('detail', 'Given')
		expect(hidden.getFillState().notApplicable.map((item) => item.key)).toEqual(['detail'])
		expect(hidden.validate().errors).toContainEqual({
			field: 'fields.detail',
			message: "A value is given, but this field does not apply. It applies when: fields.mode == 'full'",
		})
	})

	test('a field that an update shows gets its default in the data, the JSON and the output', async () => {
		const empty = (await deliveryForm()).fill({})
		const shown = empty.update({ fields: { mode: 'full' } })

		expect(empty.fields).not.toHaveProperty('req')
		expect(empty.validate().errors.map((error) => error.field)).toEqual(['fields.mode'])
		expect(shown.fields).toMatchObject({ detail: 'Standard', req: 'R', express: 'yes', courier: 'Fast Co', extras: { tag: 'T', gift: true } })
		expect(shown.fields).not.toHaveProperty('custom')
		expect(shown.toJSON().fields).toMatchObject({ detail: 'Standard', req: 'R', extras: { tag: 'T', gift: true } })
		expect(shown.validate().errors).toEqual([])
		expect(await shown.render()).toBe('Mode full. Detail [Standard]. Req [R]. Tag [T]. Custom [].')
	})

	test('a signable form keeps the defaults the draft had', async () => {
		const signable = (await deliveryForm()).fill({}).update({ fields: { mode: 'full' } }).prepareForSigning()

		expect(signable.fields).toMatchObject({ detail: 'Standard', req: 'R', extras: { tag: 'T', gift: true } })
		expect(signable.toJSON().fields).toMatchObject({ detail: 'Standard', req: 'R' })
	})

	test('a sealed form prints and keeps the defaults that apply, and none that do not', async () => {
		const printed: unknown[] = []
		const adapter: SealAdapter = {
			async convert(request) {
				printed.push(request.document.content)
				return { pdf: sealedPdf, signatureMap: [] }
			},
		}
		const draft = await signedDelivery()
		const full = await draft.update({ fields: { mode: 'full' } }).seal({ adapter })
		const short = await draft.update({ fields: { mode: 'full' } }).update({ fields: { mode: 'short' } }).seal({ adapter })

		expect(printed).toEqual([
			'Mode full. Detail [Standard]. Req [R]. Tag [T]. Custom [].',
			'Mode short. Detail []. Req []. Tag []. Custom [Own terms].',
		])
		expect(full.fields).toMatchObject({ req: 'R', extras: { tag: 'T', gift: true } })
		expect(short.fields).not.toHaveProperty('req')
	})

	test('removing one default hides a field whose condition read it, and shows a field it hid', async () => {
		const short = (await deliveryForm()).fill({ fields: { mode: 'short' } })
		const full = (await deliveryForm()).fill({ fields: { mode: 'full' } })

		expect(full.fields).toMatchObject({ express: 'yes', courier: 'Fast Co', standard: true })
		expect(full.fields).not.toHaveProperty('custom')
		expect(short.fields).not.toHaveProperty('courier')
		expect(short.fields).toHaveProperty('custom', 'Own terms')
		expect(short.validate().valid).toBe(true)
	})

	test('a given value keeps a field visible that a default alone would not', async () => {
		const draft = (await deliveryForm()).fill({ fields: { mode: 'short', express: 'yes' } })

		expect(draft.fields).toHaveProperty('courier', 'Fast Co')
		expect(draft.validate().errors.map((error) => error.field)).toEqual(['fields.express'])
	})

	test('reset removes the given value: a hidden field then has no value, and a visible one has its default', async () => {
		const hidden = (await deliveryForm()).fill({ fields: { mode: 'short', detail: 'Given' } }).reset('fields.detail')
		const visible = (await deliveryForm()).fill({ fields: { mode: 'full', detail: 'Given' } }).reset('fields.detail')

		expect(hidden.fields).not.toHaveProperty('detail')
		expect(hidden.validate().valid).toBe(true)
		expect(visible.fields).toHaveProperty('detail', 'Standard')
		expect(visible.update({ fields: { mode: 'short' } }).validate().valid).toBe(true)
	})

	test('a fieldset that applies gets its defaults without a given object, and a hidden one gets no object', async () => {
		const shown = (await deliveryForm()).fill({ fields: { mode: 'full' } })
		const hidden = (await deliveryForm()).fill({ fields: { mode: 'short' } })

		expect(shown.fields.extras).toEqual({ tag: 'T', gift: true })
		expect(hidden.fields).not.toHaveProperty('extras')
		expect(hidden.toJSON().fields).not.toHaveProperty('extras')
	})

	test('a hidden field in a list row gets no default, and a visible one in the same row does', async () => {
		const hidden = (await deliveryForm()).fill({ fields: { mode: 'short', rows: [{}] } })
		const shown = hidden.update({ fields: { showNotes: true } })

		expect(hidden.fields.rows).toEqual([{ label: 'Row' }])
		expect(shown.fields.rows).toEqual([{ label: 'Row', note: 'None' }])
		expect(shown.update({ fields: { showNotes: false } }).validate().valid).toBe(true)
	})

	test('a draft restored from JSON tells its defaults from its given values', async () => {
		const json = (await deliveryForm()).fill({ fields: { mode: 'full', detail: 'Given' } }).toJSON() as DraftFormJSON<Form>
		const restored = (await runtimeFormFromJSON(json)) as DraftForm<Form>
		const asGiven = (await runtimeFormFromJSON({ ...json, defaulted: undefined })) as DraftForm<Form>

		expect(json.defaulted).toEqual(expect.arrayContaining(['req', 'express', 'courier', 'standard', 'extras.tag', 'extras.gift']))
		expect(json.defaulted).not.toContain('detail')
		const restoredShort = restored.update({ fields: { mode: 'short' } })
		const givenShort = asGiven.update({ fields: { mode: 'short' } })
		expect(restoredShort.validate().errors.map((error) => error.field)).toEqual(['fields.detail'])
		expect(givenShort.validate().errors.map((error) => error.field)).toContain('fields.req')
	})
})

describe('a default on a field whose condition reads a party or the context', () => {
	async function unitForm() {
		return await form.load({
			kind: 'form',
			name: 'unit-defaults',
			parties: { tenant: { label: 'Tenant', partyType: 'person', min: 0 } },
			fields: {
				unit: { type: 'text', default: 'A1', visible: 'parties.tenant.name != null' },
				dueDate: { type: 'date' },
				lateFee: { type: 'text', default: 'Due', visible: 'today() > fields.dueDate' },
			},
		} as never)
	}

	test('a party that makes a field apply gives it its default, and no party leaves it without one', async () => {
		const without = (await unitForm()).fill({})
		const withTenant = without.setParty('tenant' as never, { name: 'Ada' } as never)

		expect(without.fields).not.toHaveProperty('unit')
		expect(without.validate().valid).toBe(true)
		expect(withTenant.fields).toHaveProperty('unit', 'A1')
	})

	test('the context clock decides whether a dated field gets its default', async () => {
		const seed = { fields: { dueDate: '2026-12-31' } } as never
		const before = (await unitForm()).fill(seed, { context: { asOf: '2026-06-01T00:00:00Z' } })
		const after = (await unitForm()).fill(seed, { context: { asOf: '2027-02-01T00:00:00Z' } })

		expect(before.fields).not.toHaveProperty('lateFee')
		expect(before.validate().valid).toBe(true)
		expect(after.fields).toHaveProperty('lateFee', 'Due')
	})
})

describe('parsing data reads the clock and the parties as fill does', () => {
	async function unitForm() {
		return await form.load({
			kind: 'form',
			name: 'unit-parse',
			parties: { tenant: { label: 'Tenant', partyType: 'person', min: 0 } },
			fields: {
				unit: { type: 'text', default: 'A1', visible: 'parties.tenant.name != null' },
				dueDate: { type: 'date' },
				lateFee: { type: 'text', default: 'Due', required: true, visible: 'today() > fields.dueDate' },
			},
		} as never)
	}

	test('parseData takes the context clock for a condition that reads today()', async () => {
		const data = { fields: { dueDate: '2026-12-31' } }
		const late = (await unitForm()).safeParseData(data, { context: { asOf: '2027-02-01T00:00:00Z' } })
		const early = (await unitForm()).safeParseData(data, { context: { asOf: '2026-06-01T00:00:00Z' } })
		const noClock = (await unitForm()).safeParseData(data)

		expect(late.errors).toBeNull()
		expect(late.data?.fields).toHaveProperty('lateFee', 'Due')
		expect(early.data?.fields).not.toHaveProperty('lateFee')
		expect(noClock.errors).toBeNull()
	})

	test('parseData decides a default from the parties in the data', async () => {
		const withTenant = (await unitForm()).safeParseData({ fields: {}, parties: { tenant: { name: 'Ada' } } }, { context: { asOf: '2026-06-01T00:00:00Z' } })
		const without = (await unitForm()).safeParseData({ fields: {} }, { context: { asOf: '2026-06-01T00:00:00Z' } })

		expect(withTenant.errors).toBeNull()
		expect(withTenant.data?.fields).toHaveProperty('unit', 'A1')
		expect(without.data?.fields).not.toHaveProperty('unit')
	})
})

describe('defaults that show each other in turn', () => {
	test('a default hidden in one round that applies at the end gets its value', async () => {
		const chain = await form.load({
			kind: 'form',
			name: 'chain',
			fields: {
				p: { type: 'boolean', default: true },
				q: { type: 'text', default: 'Q', visible: "fields.p != true or fields.r == 'R'" },
				r: { type: 'text', default: 'R', visible: 'fields.p == true' },
			},
		} as never)
		const draft = chain.fill({})

		expect(draft.fields).toEqual({ p: true, q: 'Q', r: 'R' })
		expect(draft.validate().valid).toBe(true)
	})
})

describe('parsing data decides defaults and requiredness from the evaluated state', () => {
	test('a hidden required field with a default is not required and gets no value', async () => {
		const parsed = (await deliveryForm()).safeParseData({ fields: { mode: 'short' } })

		expect(parsed.errors).toBeNull()
		expect(parsed.data?.fields).not.toHaveProperty('req')
		expect(parsed.data?.fields).not.toHaveProperty('detail')
		expect(parsed.data?.fields).toHaveProperty('custom', 'Own terms')
	})

	test('a visible required field with a default gets its value', async () => {
		const parsed = (await deliveryForm()).safeParseData({ fields: { mode: 'full' } })

		expect(parsed.success).toBe(true)
		expect(parsed.data?.fields).toMatchObject({ req: 'R', detail: 'Standard', extras: { tag: 'T', gift: true } })
	})

	test('a missing required field and a value given for a hidden field are refused', async () => {
		const missing = (await deliveryForm()).safeParseData({ fields: {} })
		const inapplicable = (await deliveryForm()).safeParseData({ fields: { mode: 'short', detail: 'Given' } })

		expect(missing.errors?.map((error) => error.field)).toEqual(['fields.mode'])
		expect(inapplicable.errors?.map((error) => error.field)).toEqual(['fields.detail'])
	})
})

describe('defaults that decide their own visibility are refused by artifact validation', () => {
	const definition = (fields: Record<string, unknown>, defs?: Record<string, unknown>) =>
		({ kind: 'form', name: 'cyclic-defaults', fields, ...(defs && { defs }) }) as never
	const refusal = async (fields: Record<string, unknown>, defs?: Record<string, unknown>): Promise<string> => {
		const result = validateArtifact(definition(fields, defs)) as { issues?: Array<{ message: string }> }
		const loaded = await form.load(definition(fields, defs))
		expect(() => loaded.fill({})).toThrow('decide whether these fields apply')
		return (result.issues ?? []).map((issue) => issue.message).join('; ')
	}

	test('two defaults that each hide the other', async () => {
		const fields = {
			left: { type: 'text', default: 'L', visible: 'fields.right == null' },
			right: { type: 'text', default: 'R', visible: 'fields.left == null' },
		}
		expect(await refusal(fields)).toContain('The defaults of fields.left, fields.right decide whether these fields apply')
	})

	test('a default that its own condition reads, a loop through a computed value, and one through a fieldset', async () => {
		const alone = { alone: { type: 'text', default: 'A', visible: 'fields.alone == null' } }
		expect(await refusal(alone)).toContain('The defaults of fields.alone decide')

		const throughDef = { a: { type: 'text', default: 'A', visible: 'hasB' }, b: { type: 'text', default: 'B', visible: 'fields.a == null' } }
		const defs = { hasB: { type: 'boolean', value: 'fields.b != null' } }
		expect(await refusal(throughDef, defs)).toContain('The defaults of fields.a, fields.b decide')

		const inBox = { box: { type: 'fieldset', visible: 'fields.box.flag != true', fields: { flag: { type: 'boolean', default: true } } } }
		expect(await refusal(inBox)).toContain('The defaults of fields.box.flag decide')
	})

	test('a ring of sixteen defaults is refused at once', async () => {
		const ring = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
			`b${index}`,
			{ type: 'boolean', default: true, visible: `fields.b${(index + 1) % 16} == null` },
		]))
		const started = performance.now()

		expect(await refusal(ring)).toContain('The defaults of fields.b0,')
		expect(performance.now() - started).toBeLessThan(1000)
	})

	test('a chain of forty defaults, each shown by the one before, is valid and settles in bounded rounds', async () => {
		const chain = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [
			`f${index}`,
			{ type: 'text', default: 'x', ...(index > 0 && { visible: `fields.f${index - 1} == 'x'` }) },
		]))
		const loaded = await form.load(definition(chain))
		const started = performance.now()
		const draft = loaded.fill({})

		expect(validateArtifact(definition(chain))).not.toHaveProperty('issues')
		expect(Object.keys(draft.fields)).toHaveLength(40)
		expect(draft.update({ fields: { f0: 'y' } } as never).fields).toEqual({ f0: 'y' })
		expect(performance.now() - started).toBeLessThan(2000)
	})
})
