import { Document, Totals } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

export default function TotalsBadDataComposition({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <Totals rows={[{ def: 'total' }]} />
    </Document>
  )
}

/** `amount` is real data, but not a number — the money serializer rejects it. */
export const sample: DocumentData = { fields: { amount: 'not-a-number', currency: 'USD' }, parties: {} }
