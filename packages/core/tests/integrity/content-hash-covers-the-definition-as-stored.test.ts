import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'
import { form, runtimeChecklistFromJSON, runtimeDocumentFromJSON, runtimeFormFromJSON } from '@/artifacts'
import { load } from '@/serialization'
import { toYAML } from '@/serialization/serialization'
import { canonicalJson } from '@/integrity/canonical-json'
import { contentHashOf } from '@/integrity/seal-integrity'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'migration', 'fixtures', '2026-11-06')
const storedText = (file: string) => readFileSync(join(fixtures, file), 'utf8')
const sha256 = (text: string) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const current = {
	$schema: ASTERDOC_SCHEMA_URL,
	kind: 'form',
	name: 'intake',
	version: '1.0.0',
	title: 'Intake',
	fields: { name: { type: 'text', label: 'Name', required: true } },
	layers: { body: { kind: 'inline', mimeType: 'text/markdown', text: 'Name: {{fields.name}}' } },
	defaultLayer: 'body',
}

describe('the content hash of a definition', () => {
	test('is the SHA-256 of the RFC 8785 JSON of the parsed file', async () => {
		const text = JSON.stringify(current, null, 2)
		expect(await load(text).contentHash()).toBe(sha256(canonicalJson(JSON.parse(text))))
	})

	test('does not depend on key order, whitespace or number spelling in the file', async () => {
		const reordered = `{"defaultLayer":"body","version":"1.0.0","layers":{"body":{"text":"Name: {{fields.name}}","mimeType":"text/markdown","kind":"inline"}},
			"title":"Intake","name":"intake","kind":"form","fields":{"name":{"required":true,"label":"Name","type":"text"}},"$schema":"${ASTERDOC_SCHEMA_URL}"}`
		expect(await load(reordered).contentHash()).toBe(await load(JSON.stringify(current)).contentHash())
	})

	test('is the same for a YAML file and a JSON file of the same document', async () => {
		expect(await load(toYAML(current)).contentHash()).toBe(await load(JSON.stringify(current)).contentHash())
	})

	test('changes when the definition changes', async () => {
		const changed = { ...current, title: 'Intake form' }
		expect(await load(JSON.stringify(changed)).contentHash()).not.toBe(await load(JSON.stringify(current)).contentHash())
	})

	test('hashes a definition made in memory as what toJSON() writes for it', async () => {
		const built = form()
			.name('intake')
			.version('1.0.0')
			.fields({ name: { type: 'text', label: 'Name' } })
			.inlineLayer('body', { mimeType: 'text/markdown', text: 'Name: {{fields.name}}' })
			.build()
		const hash = await built.contentHash()
		expect(hash).toBe(await contentHashOf(built.toJSON()))
		expect(await form.from(built.toJSON()).contentHash()).toBe(hash)
		const { $schema: _schema, ...withoutSchema } = current
		expect(await form(withoutSchema as never).contentHash()).toBe(await contentHashOf(form(withoutSchema as never).toJSON()))
	})
})

describe('the content hash of a definition written for an earlier schema date', () => {
	test.each(['lease.json', 'notice.json', 'move-in.json', 'move-in-packet.json'])(
		'is taken over %s as stored, at its original $schema, not over the upgraded form',
		async (file) => {
			const text = storedText(file)
			const instance = load(text)
			expect(instance.migratedFrom).toBe('2026-11-06')
			expect(await instance.contentHash()).toBe(sha256(canonicalJson(JSON.parse(text))))
			expect(await instance.contentHash()).not.toBe(await contentHashOf(instance.toJSON()))
		},
	)

	test('stays the same across the identity upgrade, every reload and every restore', async () => {
		const text = storedText('lease.json')
		const stored = sha256(canonicalJson(JSON.parse(text)))
		const draft = load<'form'>(text).fill({ fields: { tenant: 'Ada' } })
		expect(await draft.contentHash()).toBe(stored)
		const restored = runtimeFormFromJSON(roundTrip(draft.toJSON()))
		expect(restored.migratedFrom).toBe('2026-11-06')
		expect(await restored.contentHash()).toBe(stored)
		expect(await runtimeFormFromJSON(roundTrip(restored.toJSON())).contentHash()).toBe(stored)
	})
})

describe('the content hash of a runtime', () => {
	test('survives fill, toJSON and restore', async () => {
		const definition = load<'form'>(JSON.stringify(current))
		const hash = await definition.contentHash()
		const draft = definition.fill({ fields: { name: 'Ada' } })
		expect(await draft.contentHash()).toBe(hash)
		const restored = runtimeFormFromJSON(roundTrip(draft.toJSON()))
		expect(await restored.contentHash()).toBe(hash)
		if (restored.phase !== 'draft') throw new Error('expected a draft')
		expect(await restored.update({ fields: { name: 'Grace' } }).contentHash()).toBe(hash)
		expect(restored.migratedFrom).toBeUndefined()
	})

	test('survives fill, toJSON and restore for a form made in memory', async () => {
		const built = form()
			.name('intake')
			.version('1.0.0')
			.fields({ name: { type: 'text', label: 'Name' } })
			.inlineLayer('body', { mimeType: 'text/markdown', text: 'Name: {{fields.name}}' })
			.build()
		const draft = built.fill({ fields: { name: 'Ada' } })
		expect(await runtimeFormFromJSON(roundTrip(draft.toJSON())).contentHash()).toBe(await built.contentHash())
	})

	test('is the definition hash for documents and checklists, before and after a restore', async () => {
		const notice = load<'document'>(storedText('notice.json'))
		const prepared = notice.prepare()
		expect(await prepared.contentHash()).toBe(await notice.contentHash())
		expect(await runtimeDocumentFromJSON(roundTrip(prepared.toJSON())).contentHash()).toBe(await notice.contentHash())

		const moveIn = load<'checklist'>(storedText('move-in.json'))
		const filled = moveIn.fill()
		expect(await filled.contentHash()).toBe(await moveIn.contentHash())
		expect(await runtimeChecklistFromJSON(roundTrip(filled.toJSON())).contentHash()).toBe(await moveIn.contentHash())
	})
})
