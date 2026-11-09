import { Document, Field } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

export default function LayerFormatComposition({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <Field path="signedOn" className="flex flex-col gap-1" />
    </Document>
  )
}

export const sample: DocumentData = { fields: { signedOn: '2021-06-15T10:00:00Z' }, parties: {} }
