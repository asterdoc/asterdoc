import { describe, expect, it } from 'vitest'
import { executeFill } from '../src/tools/fill'
import { executeInspectArtifact } from '../src/tools/inspect-artifact'
import { executeUpdateFill } from '../src/tools/update-fill'
import { executeValidateInput } from '../src/tools/validate-input'

const artifact = {
  kind: 'form' as const,
  name: 'masked',
  fields: {
    ssn: { type: 'text', label: 'SSN', mask: '###-##-####' },
    name: { type: 'text', label: 'Name' },
  },
}

describe('a masked field through the agent tools', () => {
  it('stores a value given with or without separators without them', async () => {
    const filled = await executeFill({ source: 'artifact', artifact, data: { fields: { ssn: '123-45-6789' } } })
    expect(filled).toMatchObject({ accepted: true, data: { fields: { ssn: '123456789' } } })
    const updated = await executeUpdateFill({ source: 'artifact', artifact, data: { fields: {} }, patch: { fields: { ssn: '987654321' } } })
    expect(updated).toMatchObject({ accepted: true, data: { fields: { ssn: '987654321' } } })
  })

  it('refuses a value that does not fit with mask_mismatch and the expected shape', async () => {
    const result = await executeUpdateFill({ source: 'artifact', artifact, data: { fields: {} }, patch: { fields: { ssn: '123-456-789' } } })
    expect(result.accepted).toBe(false)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'mask_mismatch', path: ['fields', 'ssn'], message: expect.stringContaining('written 123-45-6789 or 123456789') })])
    const other = await executeFill({ source: 'artifact', artifact, data: { fields: { name: 7 } } })
    expect(other.errors).toEqual([expect.objectContaining({ code: 'validation_error' })])
  })

  it('validates one masked input to its stored form', async () => {
    const result = await executeValidateInput({ source: 'artifact', artifact, target: 'field', field_path: 'ssn', value: '123-45-6789' })
    expect(result).toMatchObject({ valid: true, normalized_value: '123456789' })
    const refused = await executeValidateInput({ source: 'artifact', artifact, target: 'field', field_path: 'ssn', value: '12-3' })
    expect(refused).toMatchObject({ valid: false, errors: [expect.objectContaining({ code: 'mask_mismatch' })] })
  })

  it('shows the mask and how it accepts input when inspecting fields', async () => {
    const result = await executeInspectArtifact({ source: 'artifact', artifact, sections: ['fields'] })
    const fields = (result as { sections?: { fields?: Record<string, Record<string, unknown>> } }).sections?.fields
    expect(fields?.ssn).toMatchObject({ mask: '###-##-####', input: expect.stringContaining('with or without its separators') })
    expect(fields?.name).not.toHaveProperty('input')
  })
})
