import { Document, Field } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

/** `doesNotExist` is not a field the artifact declares. */
export default function UnresolvedPathComposition({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <Field path="doesNotExist" />
    </Document>
  )
}

export const sample: DocumentData = { fields: { name: 'Ada Lovelace' }, parties: {} }
