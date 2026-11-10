import { unzipSync, zipSync } from 'fflate'
import { createTypeEnv, T } from '@asterdoc/expr'
import type { Form } from '@asterdoc/types'
import { describe, expect, it } from 'vitest'
import { ArtifactFieldFormatError, renderText } from '../src/text'
import { checkDocxTemplate, renderDocx } from '../src/docx'
import { renderPdf } from '../src/pdf'
import { textFieldsPdf } from './pdf-fixtures'

const form = (sensitive: boolean): Form => ({
  kind: 'form',
  name: 'masked',
  fields: {
    ssn: { type: 'text', label: 'SSN', sensitive },
    owners: { type: 'list', label: 'Owners', item: { type: 'fieldset', label: 'Owner', fields: { ein: { type: 'text', label: 'EIN', sensitive } } } },
  },
  defs: { plain: { type: 'string', value: 'fields.ssn' } },
} as unknown as Form)

const secret = 'SECRET-SSN-VALUE'
const data = { ssn: secret, owners: [{ ein: secret }] }

const failure = async (run: () => unknown): Promise<ArtifactFieldFormatError> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof ArtifactFieldFormatError) return error
    throw error
  }
  throw new Error('expected a format error')
}

const encoder = new TextEncoder()
const docx = (body: string) => zipSync({
  '[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': encoder.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': encoder.encode(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
})
const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const expectRedacted = (error: ArtifactFieldFormatError) => {
  expect(error.message).toContain('[redacted] (string, length 16)')
  expect(error.message).not.toContain(secret)
  expect(JSON.stringify(error.issues)).not.toContain(secret)
}

describe('a mask that a sensitive value does not fit names no value', () => {
  it('in a text placeholder and in a loop row', async () => {
    expectRedacted(await failure(() => renderText({ form: form(true), data, template: '{{ fields.ssn | text.mask="###-##-####" }}' })))
    expectRedacted(await failure(() => renderText({ form: form(true), data, template: '{{#each fields.owners}}{{ item.ein | text.mask="##-#######" }}{{/each}}' })))
  })

  it('in a Word template', async () => {
    expectRedacted(await failure(() => renderDocx({ form: form(true), data, template: docx(paragraph('{{ fields.ssn | text.mask="###-##-####" }}')) })))
  })

  it('in a PDF binding mask', async () => {
    expectRedacted(await failure(() => renderPdf({
      form: form(true),
      data,
      template: textFieldsPdf(['ssn']),
      bindings: { ssn: { path: 'fields.ssn', format: { text: { mask: '###-##-####' } } } },
    })))
  })

  it('keeps the value for a field that is not sensitive', async () => {
    const error = await failure(() => renderText({ form: form(false), data, template: '{{ fields.ssn | text.mask="###-##-####" }}' }))
    expect(error.message).toContain(secret)
  })
})

describe('a Word loop row name that shadows a root or a computed value', () => {
  const env = createTypeEnv({ fields: T.object, 'fields.owners': T.array(T.object), 'fields.owners.ein': T.string, plain: T.string, parties: T.object })
  const loop = (alias: string) => docx([`{{FOR ${alias} IN fields.owners}}`, `{{ ${alias}.ein }}`, `{{END-FOR ${alias}}}`].map(paragraph).join(''))

  it('is refused by the template check', () => {
    for (const alias of ['plain', 'parties', 'fields']) {
      expect(checkDocxTemplate(loop(alias), env).map((issue) => issue.code)).toContain('loop-alias')
    }
    expect(checkDocxTemplate(loop('owner'), env).map((issue) => issue.code)).not.toContain('loop-alias')
  })

  it('is refused at render', async () => {
    const rows = { ...data, owners: [{ ein: '1' }], defs: { plain: 'x' } }
    await expect(renderDocx({ form: form(true), data: rows, template: loop('plain') })).rejects.toThrow(/FOR plain shadows plain/)
    await expect(renderDocx({ form: form(true), data: rows, template: loop('fields') })).rejects.toThrow(/FOR fields shadows fields/)
    const bytes = await renderDocx({ form: form(false), data: { ...data, owners: [{ ein: '1' }] }, template: loop('owner') })
    expect(new TextDecoder().decode(unzipSync(bytes)['word/document.xml'])).toContain('>1<')
  })
})
