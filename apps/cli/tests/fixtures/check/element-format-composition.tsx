import { Document, Field } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

export default function ElementFormatComposition({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <Field path="name" format={{ date: { pattern: 'MM/DD/YYYY' } }} className="flex flex-col gap-1" />
    </Document>
  )
}

export const sample: DocumentData = { fields: { name: 'Ada Lovelace' }, parties: {} }
