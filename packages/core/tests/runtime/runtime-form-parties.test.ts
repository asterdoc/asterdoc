import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test, expect } from 'vitest'
import { form, runtimeFormFromJSON, FormValidationError } from '@/artifacts'
import type { SealAdapter, SealAdapterRequest, SigningField } from '@asterdoc/types'

const fixturePdf = new Uint8Array(
	readFileSync(join(__dirname, '..', 'artifacts', 'form', 'fixtures', 'one-field-form.pdf')),
)

/**
 * Party mutation on a draft: every party a form holds carries the
 * `<role>-<index>` id core assigns, whichever way it entered the form.
 */
describe('RuntimeForm party ids', () => {
	const createForm = async () =>
		await form.load(form()
			.name('sale')
			.version('1.0.0')
			.title('Sale')
			.fields({ price: { type: 'number', label: 'Price' } })
			.parties({
				buyer: { label: 'Buyer', partyType: 'person', signature: { required: true } },
				witness: { label: 'Witness', partyType: 'person', min: 0, max: 3 },
			})
			.inlineLayer('text', {
				mimeType: 'text/plain',
				text: 'Buyer {{parties.buyer.name}} by {{printedName(parties.buyer, "buyer-name")}}',
			})
			.defaultLayer('text')
			.build())

	const draftWithBuyer = async () =>
		(await createForm())
			.fill({})
			.setParty('buyer', { name: 'Bea Buyer' })
			.addSigner('bea', { person: { name: 'Bea Signer' } })
			.addSignatory('buyer', 'buyer-0', { signerId: 'bea' })

	describe('setParty', () => {
		test('assigns the role-index id, so the draft validates, renders and seals with its signatories', async () => {
			const draft = await draftWithBuyer()

			expect((await draft).getParty('buyer')).toEqual({ name: 'Bea Buyer', id: 'buyer-0' })
			expect((await draft).validate().errors).toEqual([])
			expect((await draft).getSignatureStatus('buyer').parties).toEqual([
				{ partyId: 'buyer-0', hasSignatory: true, hasCapture: false, witnessed: false },
			])
			expect(await (await draft).render()).toBe('Buyer Bea Buyer by Bea Signer')

			let request: SealAdapterRequest | undefined
			const signatureMap: SigningField[] = [
				{ id: 'buyer-sig', signerIndex: 0, signerId: 'bea', type: 'signature', page: 1, x: 0, y: 0, width: 10, height: 10 },
			]
			const adapter: SealAdapter = {
				async convert(sealingRequest) {
					request = sealingRequest as SealAdapterRequest
					return { pdf: fixturePdf, signatureMap }
				},
			}
			const sealed = await (await draft).seal({ adapter })
			expect(sealed.phase).toBe('signable')
			expect(sealed.signatureMap).toEqual(signatureMap)
			expect(request?.document.content).toBe('Buyer Bea Buyer by Bea Signer')
			expect(request?.parties.buyer).toEqual({ name: 'Bea Buyer', id: 'buyer-0' })
		})

		test('assigns ids to every party of a multiply-filled role', async () => {
			const draft = (await createForm()).fill({}).setParty('witness', [{ name: 'W0' }, { name: 'W1' }])
			expect(draft.getParties('witness').map((party) => party.id)).toEqual(['witness-0', 'witness-1'])
		})

		test('rejects an id that does not match the party position', async () => {
			await expect((async () => (await createForm()).fill({}).setParty('buyer', { name: 'B', id: 'someone' } as never))()).rejects.toThrow('Party ID "someone" does not match expected "buyer-0".')
		})

		test('rejects a party shape the role does not accept', async () => {
			await expect((async () => (await createForm()).fill({}).setParty('witness', { name: 'W0' }))()).rejects.toThrow(FormValidationError)
			await expect((async () => (await createForm()).fill({}).setParty('buyer', { name: 'B', address: '1 Main St' } as never))()).rejects.toThrow('Unrecognized key: "address"')
		})
	})

	describe('addParty', () => {
		test('appends with the next role-index id', async () => {
			const draft = (await draftWithBuyer()).addParty('witness', { name: 'W0' }).addParty('witness', { name: 'W1' })
			expect(draft.getParties('witness')).toEqual([
				{ name: 'W0', id: 'witness-0' },
				{ name: 'W1', id: 'witness-1' },
			])
			expect(draft.validate().errors).toEqual([])
		})

		test('fills an empty single-party role and refuses a second party', async () => {
			const draft = (await createForm()).fill({}).addParty('buyer', { name: 'B' })
			expect(draft.getParty('buyer')).toEqual({ name: 'B', id: 'buyer-0' })
			expect(() => draft.addParty('buyer', { name: 'C' })).toThrow('accepts a single party')
		})

		test('refuses a party beyond the role maximum', async () => {
			const draft = (await createForm()).fill({}).setParty('witness', [{ name: 'W0' }, { name: 'W1' }, { name: 'W2' }])
			expect(() => draft.addParty('witness', { name: 'W3' })).toThrow('allows at most 3 parties')
		})
	})

	describe('removeParty', () => {
		const threeWitnesses = async () =>
			(await draftWithBuyer())
				.setParty('witness', [{ name: 'W0' }, { name: 'W1' }, { name: 'W2' }])
				.addSigner('s0', { person: { name: 'S0' } })
				.addSigner('s2', { person: { name: 'S2' } })
				.addSignatory('witness', 'witness-0', { signerId: 's0' })
				.addSignatory('witness', 'witness-2', { signerId: 's2' })

		test('re-indexes later parties and moves their signatories', async () => {
			const draft = (await threeWitnesses()).removeParty('witness', 1)

			expect(draft.getParties('witness')).toEqual([
				{ name: 'W0', id: 'witness-0' },
				{ name: 'W2', id: 'witness-1' },
			])
			expect(draft.signatories.witness).toEqual({
				'witness-0': [{ signerId: 's0' }],
				'witness-1': [{ signerId: 's2' }],
			})
			expect(draft.validate().errors).toEqual([])
		})

		test('drops the removed party signatories and keeps a single survivor in a list', async () => {
			const draft = (await threeWitnesses()).removeParty('witness', 0).removeParty('witness', 0)

			expect(draft.getParty('witness')).toEqual([{ name: 'W2', id: 'witness-0' }])
			expect(draft.signatories.witness).toEqual({ 'witness-0': [{ signerId: 's2' }] })
		})

		test('clears the role and its signatories when the last party goes', async () => {
			const draft = (await draftWithBuyer()).removeParty('buyer', 0)
			expect(draft.getParty('buyer')).toBeUndefined()
			expect(draft.signatories.buyer).toBeUndefined()
		})

		test('rejects an index outside the role', async () => {
			await expect((async () => (await threeWitnesses()).removeParty('witness', 3))()).rejects.toThrow('Invalid party index 3')
			await expect((async () => (await threeWitnesses()).removeParty('witness', 0.5))()).rejects.toThrow('Invalid party index 0.5')
		})
	})

	describe('runtimeFormFromJSON', () => {
		test('restores parties with their ids', async () => {
			const restored = await runtimeFormFromJSON((await draftWithBuyer()).toJSON())
			expect(restored.getParty('buyer')).toEqual({ name: 'Bea Buyer', id: 'buyer-0' })
			expect(restored.validate().errors).toEqual([])
		})

		test('assigns the id to a stored party that lacks one', async () => {
			const json = (await draftWithBuyer()).toJSON()
			const restored = await runtimeFormFromJSON({ ...json, parties: { buyer: { name: 'Bea Buyer' } } } as never)
			expect(restored.getParty('buyer')).toEqual({ name: 'Bea Buyer', id: 'buyer-0' })
		})

		test('rejects a stored party whose id is not its role-index id', async () => {
			const json = (await draftWithBuyer()).toJSON()
			await expect(runtimeFormFromJSON({ ...json, parties: { buyer: { name: 'B', id: 'buyer-7' } } })).rejects.toThrow(FormValidationError)
			await expect(runtimeFormFromJSON({ ...json, parties: { stranger: { name: 'S', id: 'stranger-0' } } })).rejects.toThrow(FormValidationError)
		})
	})
})
