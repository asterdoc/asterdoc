import { describe, expect, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'
import type { SealAdapter } from '@asterdoc/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	a,
	runtimeBundleFromJSON,
	runtimeChecklistFromJSON,
	runtimeDocumentFromJSON,
	runtimeFormFromJSON,
} from '@/artifacts'
import { load } from '@/serialization'
import { contentHashOf } from '@/integrity/seal-integrity'
import { canonicalJson } from '@/integrity/canonical-json'
import { DefinitionNotJsonError } from '@/artifacts/shared/definition-origin'
import { createHash } from 'node:crypto'

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const contract = new Uint8Array(
	readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'artifacts', 'form', 'fixtures', 'large-contract.pdf')),
)
const adapter: SealAdapter = { convert: async () => ({ pdf: contract }) }

type Json = Record<string, any>

interface Kind {
	name: string
	definition: Json
	edit: (authoring: Json) => void
	edited: (definition: Json) => unknown
	original: unknown
	start: (instance: any) => any
	restore: (json: any) => any
	definitionOf: (json: any) => Json
}

const kinds: Kind[] = [
	{
		name: 'form',
		definition: {
			kind: 'form',
			name: 'intake',
			version: '1.0.0',
			fields: { age: { type: 'number', label: 'Age', min: 0 } },
			parties: { client: { label: 'Client', partyType: 'person', signature: { required: true } } },
			layers: { body: { kind: 'inline', mimeType: 'text/markdown', text: 'Age: {{fields.age}}' } },
			defaultLayer: 'body',
		},
		edit: (authoring) => {
			authoring.layers.body.text = 'Edited age: {{fields.age}}'
		},
		edited: (definition) => definition.layers.body.text,
		original: 'Age: {{fields.age}}',
		start: (instance) => instance.fill({ fields: { age: 10 } }),
		restore: (json) => runtimeFormFromJSON(json),
		definitionOf: (json) => json.form,
	},
	{
		name: 'document',
		definition: {
			kind: 'document',
			name: 'notice',
			version: '1.0.0',
			layers: { body: { kind: 'inline', mimeType: 'text/markdown', text: '# Notice' } },
			defaultLayer: 'body',
		},
		edit: (authoring) => {
			authoring.layers.body.text = '# Edited notice'
		},
		edited: (definition) => definition.layers.body.text,
		original: '# Notice',
		start: (instance) => instance.prepare(),
		restore: (json) => runtimeDocumentFromJSON(json),
		definitionOf: (json) => json.document,
	},
	{
		name: 'checklist',
		definition: {
			kind: 'checklist',
			name: 'move-in',
			version: '1.0.0',
			items: [{ id: 'keys', title: 'Keys handed over' }],
		},
		edit: (authoring) => {
			authoring.items[0].title = 'Keys and fobs handed over'
		},
		edited: (definition) => definition.items[0].title,
		original: 'Keys handed over',
		start: (instance) => instance.fill(),
		restore: (json) => runtimeChecklistFromJSON(json),
		definitionOf: (json) => json.checklist,
	},
	{
		name: 'bundle',
		definition: {
			kind: 'bundle',
			name: 'packet',
			version: '1.0.0',
			contents: [
				{
					type: 'inline',
					key: 'notice',
					artifact: { kind: 'document', name: 'notice', version: '1.0.0', title: 'Notice' },
				},
			],
		},
		edit: (authoring) => {
			authoring.contents[0].artifact.title = 'Edited notice'
		},
		edited: (definition) => definition.contents[0].artifact.title,
		original: 'Notice',
		start: (instance) => instance.prepare(),
		restore: (json) => runtimeBundleFromJSON(json),
		definitionOf: (json) => json.bundle,
	},
]

const loaded = (kind: Kind) => load(JSON.stringify({ $schema: ASTERDOC_SCHEMA_URL, ...kind.definition })) as any
const built = (kind: Kind) => (a as any)[kind.name](structuredClone(kind.definition))

describe.each(kinds)('a $name read from a file and edited before it runs', (kind) => {
	test('hashes, serializes and restores the edited definition the runtime runs on', async () => {
		const instance = loaded(kind)
		const original = await instance.contentHash()
		kind.edit(instance.toJSON({ includeSchema: false }))
		const edited = await instance.contentHash()
		expect(edited).not.toBe(original)
		expect(edited).toBe(await contentHashOf(instance.toJSON()))

		const runtime = kind.start(instance)
		expect(await runtime.contentHash()).toBe(edited)
		const json = roundTrip(runtime.toJSON())
		expect(kind.edited(kind.definitionOf(json))).not.toBe(kind.original)
		const restored = kind.restore(json)
		expect(await restored.contentHash()).toBe(edited)
		expect(kind.edited(kind.definitionOf(restored.toJSON()))).not.toBe(kind.original)
	})

	test('keeps the stored definition while it is unedited', async () => {
		const instance = loaded(kind)
		const runtime = kind.start(instance)
		expect(await runtime.contentHash()).toBe(await instance.contentHash())
		expect(await instance.clone().contentHash()).toBe(await instance.contentHash())
	})

	test('hashes a clone made after the edit as the edited definition', async () => {
		const instance = loaded(kind)
		kind.edit(instance.toJSON({ includeSchema: false }))
		expect(await instance.clone().contentHash()).toBe(await instance.contentHash())
	})
})

describe.each(kinds)('a $name made in memory and edited after it runs', (kind) => {
	test('leaves the earlier runtime with the definition it snapshotted', async () => {
		const instance = built(kind)
		const runtime = kind.start(instance)
		const before = await runtime.contentHash()
		expect(before).toBe(await instance.contentHash())
		kind.edit(instance.toJSON({ includeSchema: false }))
		expect(await runtime.contentHash()).toBe(before)
		expect(kind.edited(kind.definitionOf(runtime.toJSON()))).toBe(kind.original)
		expect(await instance.contentHash()).not.toBe(before)
		expect(await kind.start(instance).contentHash()).toBe(await instance.contentHash())
	})
})

describe.each(kinds)('the JSON of a $name runtime', (kind) => {
	test.each([
		['read from a file', loaded],
		['made in memory', built],
	])('is a copy: changing it leaves the runtime of a definition %s alone', async (_label, make) => {
		const runtime = kind.start(make(kind))
		const before = await runtime.contentHash()
		kind.edit(kind.definitionOf(runtime.toJSON()))
		expect(await runtime.contentHash()).toBe(before)
		expect(kind.edited(kind.definitionOf(runtime.toJSON()))).toBe(kind.original)
	})
})

describe.each(kinds)('the definition a $name runtime runs on', (kind) => {
	test.each([
		['read from a file', loaded],
		['made in memory', built],
	])('is frozen for a definition %s, so an edit throws and the runtime keeps what it was filled from', async (_label, make) => {
		const runtime = kind.start(make(kind))
		const before = await runtime.contentHash()
		expect(() => kind.edit(runtime[kind.name])).toThrow(TypeError)
		expect(kind.edited(runtime[kind.name])).toBe(kind.original)
		expect(await runtime.contentHash()).toBe(before)
		expect(kind.edited(kind.definitionOf(runtime.toJSON()))).toBe(kind.original)
	})
})

describe('a form edited after it was read', () => {
	test('cannot be edited through its draft, so seal draws, hashes and restores the definition it was filled from', async () => {
		const form = kinds[0]!
		const instance = loaded(form)
		const draft = instance
			.fill({ fields: { age: 10 }, parties: { client: { id: 'client-0', name: 'C' } } })
			.addSigner('sg', { person: { name: 'C' } })
			.addSignatory('client', 'client-0', { signerId: 'sg' })
		expect(() => {
			draft.form.layers.body.text = 'Edited age: {{fields.age}}'
		}).toThrow(TypeError)
		const sealed = await draft.seal({ adapter })
		expect(sealed.integrity.contentHash).toBe(await instance.contentHash())
		expect(await runtimeFormFromJSON(roundTrip(sealed.toJSON())).render()).toBe('Age: 10')
	})

	const sealable = (instance: any) =>
		instance
			.fill({ fields: { age: 10 }, parties: { client: { id: 'client-0', name: 'C' } } })
			.addSigner('sg', { person: { name: 'C' } })
			.addSignatory('client', 'client-0', { signerId: 'sg' })

	test('seals the edit, records its hash, and restores to the edit', async () => {
		const form = kinds[0]!
		const instance = loaded(form)
		form.edit(instance.toJSON({ includeSchema: false }))
		const sealed = await sealable(instance).seal({ adapter })
		expect(sealed.integrity.contentHash).toBe(await instance.contentHash())
		expect(sealed.toJSON().form.layers.body.text).toBe('Edited age: {{fields.age}}')
		expect(await runtimeFormFromJSON(roundTrip(sealed.toJSON())).render()).toBe('Edited age: 10')
	})

	test('no longer counts as migrated from the earlier date it was read at', async () => {
		const instance = load(JSON.stringify({ $schema: 'https://schema.asterdoc.com/2026-11-06.json', ...kinds[0]!.definition })) as any
		expect(sealable(instance).migratedFrom).toBe('2026-11-06')
		kinds[0]!.edit(instance.toJSON({ includeSchema: false }))
		const runtime = sealable(instance)
		expect(runtime.migratedFrom).toBeUndefined()
		expect((await runtime.seal({ adapter })).integrity.migratedFrom).toBeUndefined()
	})

	test('made in memory, keeps enforcing the bound it was filled with', () => {
		const instance = built(kinds[0]!)
		const draft = instance.fill({ fields: { age: 10 } })
		instance.toJSON({ includeSchema: false }).fields.age.min = 50
		expect(draft.toJSON().form.fields.age.min).toBe(0)
		const ageErrors = (runtime: any) => runtime.validate().errors.some((error: { field: string }) => error.field === 'fields.age')
		expect(ageErrors(draft)).toBe(false)
		expect(instance.safeFill({ fields: { age: 10 } }).success).toBe(false)
		expect(instance.fill({ fields: { age: 60 } }).toJSON().form.fields.age.min).toBe(50)
	})
})

describe.each(kinds)('an earlier-dated $name instance edited after it was read', (kind) => {
	const earlier = () => load(JSON.stringify({ $schema: 'https://schema.asterdoc.com/2026-11-06.json', ...kind.definition })) as any

	test('no longer reports migratedFrom, and its clone agrees with it', async () => {
		const instance = earlier()
		expect(instance.migratedFrom).toBe('2026-11-06')
		expect(instance.clone().migratedFrom).toBe('2026-11-06')
		kind.edit(instance.toJSON({ includeSchema: false }))
		expect(instance.migratedFrom).toBeUndefined()
		const clone = instance.clone()
		expect(clone.migratedFrom).toBeUndefined()
		expect(await clone.contentHash()).toBe(await instance.contentHash())
		expect(kind.start(instance).migratedFrom).toBeUndefined()
	})
})

describe('a form read from a file and edited to hold a value with no JSON form', () => {
	test('refuses to clone or hash with an error that names the value and says what to write', async () => {
		const instance = loaded(kinds[0]!)
		instance.toJSON({ includeSchema: false }).fields.age.min = Number.NaN
		expect(instance.migratedFrom).toBeUndefined()
		expect(() => instance.clone()).toThrow(DefinitionNotJsonError)
		expect(() => instance.clone()).toThrow(
			/changed after it was read and no longer has a JSON form: \$\.fields\.age\.min: NaN has no JSON form\. Write only strings/,
		)
		await expect(instance.contentHash()).rejects.toThrow(DefinitionNotJsonError)
	})
})

describe('a bundle made in memory with an inline part written for an earlier date', () => {
	const packet = {
		kind: 'bundle',
		name: 'packet',
		version: '1.0.0',
		contents: [
			{
				type: 'inline',
				key: 'notice',
				artifact: {
					$schema: 'https://schema.asterdoc.com/2026-11-06.json',
					kind: 'document',
					name: 'notice',
					version: '1.0.0',
					title: 'Notice',
				},
			},
		],
	}
	const asGiven = `sha256:${createHash('sha256').update(canonicalJson(packet)).digest('hex')}`

	test('keeps its origin: migratedFrom and the hash of the bundle as given, not of what toJSON() writes', async () => {
		const instance = a.bundle(structuredClone(packet) as never)
		expect(instance.migratedFrom).toBe('2026-11-06')
		expect(await instance.contentHash()).toBe(asGiven)
		expect(await instance.contentHash()).not.toBe(await contentHashOf(instance.toJSON()))
	})

	test('keeps both through prepare, toJSON and restore', async () => {
		const runtime = a.bundle(structuredClone(packet) as never).prepare()
		expect(runtime.migratedFrom).toBe('2026-11-06')
		expect(await runtime.contentHash()).toBe(asGiven)
		const restored = runtimeBundleFromJSON(roundTrip(runtime.toJSON()))
		expect(restored.migratedFrom).toBe('2026-11-06')
		expect(await restored.contentHash()).toBe(asGiven)
	})
})
