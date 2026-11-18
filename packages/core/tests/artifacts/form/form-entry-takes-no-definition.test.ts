import { describe, expect, it } from 'vitest'
import { a } from '@/artifacts'

const definition = { kind: 'form' as const, name: 'note', version: '1.0.0', title: 'Note', fields: { body: { type: 'text' as const, label: 'Body' } } }

describe('a.form', () => {
	it('starts a builder when called with no argument', async () => {
		const built = a.form().name('note').version('1.0.0').title('Note').fields(definition.fields).build()
		expect((await a.form.load(built)).name).toBe('note')
	})

	it('throws when given a definition, and names form.load', () => {
		expect(() => (a.form as unknown as (input: unknown) => unknown)(definition)).toThrow(/form\(\) takes no argument[\s\S]*form\.load\(definition, \{ resolver \}\)/)
		expect(() => (a.form as unknown as (input: unknown, options: unknown) => unknown)(definition, { resolver: { read: async () => new Uint8Array() } })).toThrow(TypeError)
	})
})
