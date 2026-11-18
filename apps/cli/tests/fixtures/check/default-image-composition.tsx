import { Document, Field, KeepTogether } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

export default function DefaultImageComposition({ artifact, data }: { artifact: Form; data: DocumentData }) {
  const logo = data.fields.logo
  return (
    <Document artifact={artifact} data={data}>
      {typeof logo === 'string' && <KeepTogether as="img" keepId="logo" src={logo} alt="" />}
      <Field path="name" className="flex flex-col gap-1" />
    </Document>
  )
}

export const sample: DocumentData = { fields: { name: 'Ada Lovelace' }, parties: {} }
