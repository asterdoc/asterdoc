import { describe, expect, it } from 'vitest'
import { makeInstanceTemplate } from '../../src/utils/instance-template.js'
import type { Form } from '@asterdoc/core'

describe('list template placeholder is an empty list', () => {
  it('uses an empty list', () => {
    const form = { kind: 'form', fields: { rows: { type: 'list', label: 'Rows', item: { type: 'text', label: 'Row' } } } } as unknown as Form
    expect(makeInstanceTemplate(form).fields.rows).toEqual([])
  })
})
