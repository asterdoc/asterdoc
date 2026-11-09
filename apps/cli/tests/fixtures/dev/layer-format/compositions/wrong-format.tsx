import { Document, Field } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

export default function WrongFormat({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <Field path="name" format={{ date: { pattern: 'MM/DD/YYYY' } }} />
    </Document>
  )
}

export const sample: DocumentData = { fields: { name: 'Ada Lovelace' }, parties: {} }
