import { describe, expect, test } from 'vitest'
import { form } from '@/artifacts'

const make = async () => await form.load({
  name: 'affidavit',
  parties: { affiant: { label: 'Affiant', partyType: 'person', signature: { required: true, witnesses: 1, notarized: true } } },
  layers: { md: { kind: 'inline', mimeType: 'text/markdown', text: 'x' } },
  defaultLayer: 'md',
})

const signer = { person: { name: 'Jane Doe' }, adopted: { signature: { image: 'data:...', method: 'drawn' } } } as never

const captured = async () => (await make())
  .fill({ parties: { affiant: { id: 'affiant-0', name: 'Jane Doe' } } } as never)
  .addSigner('jane', signer)
  .addSignatory('affiant', 'affiant-0', { signerId: 'jane' })
  .prepareForSigning()
  .captureSignature('affiant', 'affiant-0', 'jane', 'final-sig')

describe('signature ceremony requirements', () => {
  test('requires the declared witness count and a notary attestation', async () => {
    const signed = await captured()
    expect((await signed).getOverallSignatureStatus().complete).toBe(false)
    await expect((async () => (await signed).finalize())()).rejects.toThrow(/witnesses, or notary/)

    const witness = { id: 'wes', party: { name: 'Wes' }, notary: true } as const
    const complete = (await signed).addWitness(witness).addAttestation({
      witnessId: 'wes',
      signature: { timestamp: '2026-09-25T00:00:00Z', method: 'typed' },
      attestsTo: [{ role: 'affiant', partyId: 'affiant-0', signerId: 'jane' }],
    })
    expect(complete.getOverallSignatureStatus().complete).toBe(true)
    expect(() => complete.finalize()).not.toThrow()
  })

  test('informal finalize rejects a missing required capture', async () => {
    const signable = (await make()).fill({ parties: { affiant: { id: 'affiant-0', name: 'Jane Doe' } } } as never).prepareForSigning()
    expect(() => signable.finalize()).toThrow(/signatures/)
  })
})
