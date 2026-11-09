import { Document, Field } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

export default function Signed({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <Field path="signedOn" />
    </Document>
  )
}

export const sample: DocumentData = { fields: { signedOn: '2021-06-15T10:00:00Z' }, parties: {} }
