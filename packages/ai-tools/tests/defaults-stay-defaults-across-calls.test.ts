import { describe, expect, it } from 'vitest'
import { executeFill } from '../src/tools/fill'
import { executeRender } from '../src/tools/render'
import { executeUpdateFill } from '../src/tools/update-fill'

const artifact = {
	kind: 'form' as const,
	name: 'delivery',
	fields: {
		mode: { type: 'enum', label: 'Mode', required: true, enum: [{ value: 'short' }, { value: 'full' }] },
		detail: { type: 'text', label: 'Detail', default: 'Standard', visible: "fields.mode == 'full'" },
		reference: { type: 'text', label: 'Reference', required: true, default: 'REF-1', visible: "fields.mode == 'full'" },
	},
}

describe('a default stays a default across agent tool calls', () => {
	it('returns the given values as data and the values with defaults beside them', async () => {
		const filled = await executeFill({ source: 'artifact', artifact, data: { fields: { mode: 'full' } } })

		expect(filled.accepted).toBe(true)
		expect(filled.complete).toBe(true)
		expect(filled.data?.fields).toEqual({ mode: 'full' })
		expect(filled.values?.fields).toEqual({ mode: 'full', detail: 'Standard', reference: 'REF-1' })
	})

	it('drops the defaults of fields that a later patch hides, with no not-applicable error', async () => {
		const filled = await executeFill({ source: 'artifact', artifact, data: { fields: { mode: 'full' } } })
		const hidden = await executeUpdateFill({ source: 'artifact', artifact, data: filled.data!, patch: { fields: { mode: 'short' } } })

		expect(hidden.accepted).toBe(true)
		expect(hidden.complete).toBe(true)
		expect(hidden.values?.fields).toEqual({ mode: 'short' })
		expect(hidden.data?.fields).toEqual({ mode: 'short' })
	})

	it('gives a field that a later patch shows its default, and counts a required default as answered', async () => {
		const filled = await executeFill({ source: 'artifact', artifact, data: { fields: {} } })
		const shown = await executeUpdateFill({ source: 'artifact', artifact, data: filled.data!, patch: { fields: { mode: 'full' } } })

		expect(filled.complete).toBe(false)
		expect(shown.complete).toBe(true)
		expect(shown.values?.fields).toEqual({ mode: 'full', detail: 'Standard', reference: 'REF-1' })
		expect(shown.data?.fields).toEqual({ mode: 'full' })
	})

	it('still refuses a value given for a field that a later patch hides', async () => {
		const filled = await executeFill({ source: 'artifact', artifact, data: { fields: { mode: 'full', detail: 'Express' } } })
		const hidden = await executeUpdateFill({ source: 'artifact', artifact, data: filled.data!, patch: { fields: { mode: 'short' } } })

		expect(filled.data?.fields).toEqual({ mode: 'full', detail: 'Express' })
		expect(hidden.complete).toBe(false)
		expect(hidden.data?.fields).toEqual({ mode: 'short', detail: 'Express' })
	})

	it('keeps a cleared defaulted field empty across calls, and reset brings the default back', async () => {
		const filled = await executeFill({ source: 'artifact', artifact, data: { fields: { mode: 'full' } } })
		const cleared = await executeUpdateFill({ source: 'artifact', artifact, data: filled.data!, clear: ['fields.detail'] })
		const next = await executeUpdateFill({ source: 'artifact', artifact, data: cleared.data!, patch: { fields: { mode: 'full' } } })
		const reset = await executeUpdateFill({ source: 'artifact', artifact, data: next.data!, reset: ['fields.detail'] })

		expect(cleared.data?.fields).toEqual({ mode: 'full', detail: null })
		expect(next.accepted).toBe(true)
		expect(next.values?.fields).toEqual({ mode: 'full', reference: 'REF-1' })
		expect(reset.values?.fields).toEqual({ mode: 'full', detail: 'Standard', reference: 'REF-1' })
	})

	it('renders a form whose values are all defaults from data that gives none, and still refuses a form with no values', async () => {
		const defaulted = {
			kind: 'form' as const,
			name: 'notice',
			fields: { status: { type: 'text', label: 'Status', default: 'Open' } },
			layers: { text: { kind: 'inline', mimeType: 'text/plain', text: 'Status: {{fields.status}}' } },
		}
		const bare = { ...defaulted, fields: { status: { type: 'text', label: 'Status' } } }
		const filled = await executeFill({ source: 'artifact', artifact: defaulted, data: { fields: {} } })
		const rendered = await executeRender({ source: 'artifact', artifact: defaulted, data: filled.data! })
		const refused = await executeRender({ source: 'artifact', artifact: bare, data: { fields: {} } })

		expect(filled.complete).toBe(true)
		expect(rendered).toMatchObject({ success: true, content: 'Status: Open' })
		expect(refused.error?.code).toBe('missing_data')
	})
})
