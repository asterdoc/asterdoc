import { Document, Field } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

export default function CleanComposition({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <Field path="name" className="flex flex-col gap-1" />
    </Document>
  )
}

/** Sample data `asterdoc check` discovers automatically. */
export const sample: DocumentData = { fields: { name: 'Ada Lovelace' }, parties: {} }
