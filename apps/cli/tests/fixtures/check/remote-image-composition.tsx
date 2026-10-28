import { Document, Field, KeepTogether } from '@asterdoc/components'
import type { DocumentData } from '@asterdoc/react'
import type { Form } from '@asterdoc/types'

/** An image whose `src` is not a `data:` URI: a render would need bytes for it. */
export default function RemoteImageComposition({ artifact, data }: { artifact: Form; data: DocumentData }) {
  return (
    <Document artifact={artifact} data={data}>
      <KeepTogether as="img" keepId="logo" src="https://example.com/logo.png" alt="" />
      <Field path="name" className="flex flex-col gap-1" />
    </Document>
  )
}

export const sample: DocumentData = { fields: { name: 'Ada Lovelace' }, parties: {} }
