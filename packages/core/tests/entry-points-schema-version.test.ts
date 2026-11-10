import { describe, expect, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, SCHEMA_VERSIONS, schemaVersionUrl, type SchemaVersion } from '@asterdoc/schemas'
import { bundle, checklist, document, form, runtimeBundleFromJSON, runtimeChecklistFromJSON, runtimeDocumentFromJSON, runtimeFormFromJSON } from '@/artifacts'
import { SchemaVersionError, load, loadFromObject } from '@/serialization'
import { SchemaMigrationError, migrateArtifact, type ArtifactObject, type MigrationStep } from '@/migration'
import { validate } from '@/validation/artifact'

/**
 * One schema version rule for every entry point of every artifact kind:
 * an earlier published version is upgraded in memory, `strictSchema` refuses
 * it, and a newer or unknown version is refused.
 */

const PREVIOUS = SCHEMA_VERSIONS.at(-2) as SchemaVersion
const EARLIEST = SCHEMA_VERSIONS[0]
const EARLIER_URL = schemaVersionUrl(PREVIOUS)
const NEWER_URL = 'https://schema.asterdoc.com/2999-01-01.json'

function dropPartyMultiple(artifact: ArtifactObject): void {
	for (const party of Object.values((artifact.parties ?? {}) as Record<string, Record<string, unknown>>)) delete party.multiple
	if (artifact.kind !== 'bundle' || !Array.isArray(artifact.contents)) return
	for (const item of artifact.contents as { type?: string; artifact?: ArtifactObject }[]) {
		if (item.type === 'inline' && item.artifact) dropPartyMultiple(item.artifact)
	}
}

const steps: MigrationStep[] = [
	...SCHEMA_VERSIONS.slice(1, -1).map((to, index) => ({
		from: SCHEMA_VERSIONS[index] as SchemaVersion,
		to,
		summary: 'Changes nothing.',
		apply: (artifact: ArtifactObject) => artifact,
	})),
	{
		from: PREVIOUS,
		to: SCHEMA_VERSION,
		summary: 'Drops the party key multiple.',
		apply: (artifact) => {
			dropPartyMultiple(artifact)
			return artifact
		},
	},
]

const bodies = {
	form: { kind: 'form', name: 'intake', fields: { name: { type: 'text' } } },
	document: { kind: 'document', name: 'notice', title: 'Notice' },
	checklist: { kind: 'checklist', name: 'onboarding', items: [{ id: 'done', title: 'Done' }] },
	bundle: { kind: 'bundle', name: 'packet', contents: [{ type: 'path', key: 'cover', path: './cover.yaml' }] },
} as const

type Kind = keyof typeof bodies
const KINDS = Object.keys(bodies) as Kind[]

type Built = { name: string; migratedFrom?: SchemaVersion; toJSON(): Record<string, unknown> }
type Options = { strictSchema?: boolean }

const apis = { form, document, checklist, bundle } as unknown as Record<
	Kind,
	{
		(input: unknown, options?: Options): Built
		(): { from(input: unknown): { build(): Built } }
		from(input: unknown, options?: Options): Built
		safeFrom(input: unknown, options?: Options): { success: true; data: Built } | { success: false; error: Error }
	}
>

const entryPoints: Record<string, (kind: Kind, input: Record<string, unknown>, options?: Options) => Built> = {
	'p.<kind>(obj)': (kind, input, options) => apis[kind](input, options),
	'.from': (kind, input, options) => apis[kind].from(input, options),
	'.safeFrom': (kind, input, options) => {
		const result = apis[kind].safeFrom(input, options)
		if (!result.success) throw result.error
		return result.data
	},
	load: (_kind, input, options) => load(JSON.stringify(input), options) as unknown as Built,
	loadFromObject: (_kind, input, options) => loadFromObject(input, options) as unknown as Built,
}
const builder = (kind: Kind, input: Record<string, unknown>) => apis[kind]().from(input).build()

const cases = KINDS.flatMap((kind) => Object.keys(entryPoints).map((entry) => [kind, entry] as const))

const withSchema = (kind: Kind, $schema: unknown): Record<string, unknown> => ({ $schema, ...bodies[kind] })

function versionError(run: () => unknown): SchemaVersionError {
	try {
		run()
	} catch (error) {
		if (error instanceof SchemaVersionError) return error
		throw error
	}
	throw new Error('Expected a SchemaVersionError')
}

describe('every entry point of every kind applies the schema version rule', () => {
	test.each(cases)('%s via %s accepts the current $schema and records no migration', (kind, entry) => {
		const instance = entryPoints[entry]!(kind, withSchema(kind, ASTERDOC_SCHEMA_URL))
		expect(instance.name).toBe(bodies[kind].name)
		expect(instance.migratedFrom).toBeUndefined()
	})

	test.each(cases)('%s via %s upgrades an earlier $schema in memory and records it', (kind, entry) => {
		const input = withSchema(kind, EARLIER_URL)
		const before = structuredClone(input)
		const instance = entryPoints[entry]!(kind, input)
		expect(instance.name).toBe(bodies[kind].name)
		expect(instance.migratedFrom).toBe(PREVIOUS)
		expect(instance.toJSON().$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(input).toEqual(before)
	})

	test.each(cases)('%s via %s with strictSchema refuses an earlier $schema', (kind, entry) => {
		const error = versionError(() => entryPoints[entry]!(kind, withSchema(kind, EARLIER_URL), { strictSchema: true }))
		expect(error.code).toBe('outdated-version')
		expect(error.found).toBe(EARLIER_URL)
		expect(error.message).toContain(PREVIOUS)
		expect(error.message).toContain(SCHEMA_VERSION)
		expect(error.message).toContain('asterdoc migrate')
	})

	test.each(cases)('%s via %s refuses a newer $schema and asks for an SDK update', (kind, entry) => {
		const error = versionError(() => entryPoints[entry]!(kind, withSchema(kind, NEWER_URL)))
		expect(error.code).toBe('newer-version')
		expect(error.message).toContain('2999-01-01')
		expect(error.message).toContain('newer than this SDK knows; update @asterdoc/core')
	})

	test.each(KINDS)('the %s builder upgrades an earlier $schema too', (kind) => {
		expect(builder(kind, withSchema(kind, EARLIER_URL)).name).toBe(bodies[kind].name)
		expect(versionError(() => builder(kind, withSchema(kind, NEWER_URL))).code).toBe('newer-version')
	})

	test.each([
		['an unpublished earlier', 'https://schema.asterdoc.com/2026-11-01.json'],
		['an undated', 'https://schema.asterdoc.com/schema.json'],
		['a foreign', 'https://example.com/form.json'],
	])('%s $schema is refused by every entry point of every kind', (_label, address) => {
		for (const [kind, entry] of cases) {
			const error = versionError(() => entryPoints[entry]!(kind, withSchema(kind, address)))
			expect(error.code, `${kind} via ${entry}`).toBe('unknown-version')
		}
	})

	test.each(KINDS)('an in-memory %s without $schema is built, and serializes as current', (kind) => {
		const instance = apis[kind](bodies[kind])
		expect(instance.toJSON().$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(instance.migratedFrom).toBeUndefined()
	})

	test('a clone keeps the version its definition was upgraded from', () => {
		const instance = form.from(withSchema('form', EARLIER_URL))
		expect(instance.clone().migratedFrom).toBe(PREVIOUS)
	})
})

describe('restoring a runtime applies the rule to its definition', () => {
	type Runtime = { phase: string; migratedFrom?: SchemaVersion; toJSON(): Record<string, any> }
	const earlier = (kind: Kind) => withSchema(kind, EARLIER_URL)
	const runtimes = {
		form: [() => form.from(earlier('form')).fill({ fields: {} }), 'form', runtimeFormFromJSON],
		document: [() => document.from(earlier('document')).prepare(), 'document', runtimeDocumentFromJSON],
		checklist: [() => checklist.from(earlier('checklist')).fill({}), 'checklist', runtimeChecklistFromJSON],
		bundle: [
			() => bundle.from({ ...earlier('bundle'), contents: [{ type: 'inline', key: 'notice', artifact: bodies.document }] }).prepare(),
			'bundle',
			(json: unknown, options?: Options) => runtimeBundleFromJSON(json as never, undefined, options),
		],
	} as unknown as Record<Kind, [() => Runtime, string, (json: unknown, options?: Options) => Runtime]>

	test.each(KINDS)('a %s runtime from an earlier definition serializes it as stored and restores with migratedFrom', (kind) => {
		const [start, key, restore] = runtimes[kind]
		const runtime = start()
		expect(runtime.migratedFrom).toBe(PREVIOUS)
		const json = runtime.toJSON()
		expect(json[key].$schema).toBe(EARLIER_URL)
		const restored = restore(structuredClone(json))
		expect(restored.phase).toBe(runtime.phase)
		expect(restored.migratedFrom).toBe(PREVIOUS)
		expect(restored.toJSON()[key].$schema).toBe(EARLIER_URL)
		expect(restore(restored.toJSON()).migratedFrom).toBe(PREVIOUS)
	})

	test.each(KINDS)('a %s runtime from a current definition records no migration', (kind) => {
		const [, key, restore] = runtimes[kind]
		const json = runtimes[kind][0]().toJSON()
		const current = { ...json, [key]: { ...json[key], $schema: ASTERDOC_SCHEMA_URL } }
		const restored = restore(current)
		expect(restored.migratedFrom).toBeUndefined()
		expect(restored.toJSON()[key].$schema).toBe(ASTERDOC_SCHEMA_URL)
	})

	test.each(KINDS)('a %s runtime refuses an earlier definition with strictSchema, and a newer one always', (kind) => {
		const [start, key, restore] = runtimes[kind]
		const json = start().toJSON()
		expect(versionError(() => restore(json, { strictSchema: true })).code).toBe('outdated-version')
		expect(versionError(() => restore({ ...json, [key]: { ...json[key], $schema: NEWER_URL } })).code).toBe('newer-version')
	})
})

describe('validate() applies the rule', () => {
	test.each(KINDS)('an earlier %s is valid and returned upgraded, its input unchanged', (kind) => {
		const input = withSchema(kind, EARLIER_URL)
		const result = validate<Record<string, unknown>>(input)
		expect(result.issues).toBeUndefined()
		expect(result.issues ? undefined : result.value.$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(input.$schema).toBe(EARLIER_URL)
	})

	test.each(KINDS)('an earlier %s with strictSchema is an issue at $schema', (kind) => {
		const result = validate(withSchema(kind, EARLIER_URL), { strictSchema: true })
		expect(result.issues).toHaveLength(1)
		expect(result.issues?.[0]?.path).toEqual(['$schema'])
		expect(result.issues?.[0]?.message).toContain(SCHEMA_VERSION)
		expect(result.issues?.[0]?.message).toContain('asterdoc migrate')
	})

	test.each(KINDS)('a newer %s is an issue at $schema', (kind) => {
		const result = validate(withSchema(kind, NEWER_URL))
		expect(result.issues?.[0]?.path).toEqual(['$schema'])
		expect(result.issues?.[0]?.message).toContain('newer than this SDK knows; update @asterdoc/core')
	})

	test.each(KINDS)('a current %s, or one without $schema, is valid', (kind) => {
		expect(validate(withSchema(kind, ASTERDOC_SCHEMA_URL)).issues).toBeUndefined()
		expect(validate(bodies[kind]).issues).toBeUndefined()
		expect(validate(bodies[kind], { strictSchema: true }).issues).toBeUndefined()
	})

	test('with schema validation off, a version problem is not checked', () => {
		expect(validate(withSchema('form', NEWER_URL), { schema: false }).issues).toBeUndefined()
	})
})

describe('a bundle applies the rule to its inline parts', () => {
	const packet = (child: Record<string, unknown>, $schema: string | null = ASTERDOC_SCHEMA_URL) => ({
		...($schema !== null && { $schema }),
		kind: 'bundle',
		name: 'packet',
		contents: [
			{ type: 'inline', key: 'cover', artifact: bodies.document },
			{ type: 'inline', key: 'notice', artifact: child },
		],
	})
	const earlierChild = { $schema: EARLIER_URL, ...bodies.document }
	const partSchema = (instance: { toJSON(): unknown }) =>
		((instance.toJSON() as { contents: { artifact: { $schema?: string } }[] }).contents[1] as { artifact: { $schema?: string } }).artifact.$schema

	test.each(Object.keys(entryPoints))('an earlier inline part is upgraded via %s, and recorded', (entry) => {
		const instance = entryPoints[entry]!('bundle', packet(earlierChild))
		expect(instance.migratedFrom).toBe(PREVIOUS)
		expect(partSchema(instance)).toBe(ASTERDOC_SCHEMA_URL)
	})

	test('a bundle built in memory upgrades an earlier inline part and stays without $schema', () => {
		const instance = bundle.from(packet(earlierChild, null))
		expect(instance.migratedFrom).toBe(PREVIOUS)
		expect(instance._data.$schema).toBeUndefined()
		expect(partSchema(instance)).toBe(ASTERDOC_SCHEMA_URL)
	})

	test('the earliest version among the root and its parts is recorded', () => {
		const instance = bundle.from(packet({ $schema: schemaVersionUrl(EARLIEST), ...bodies.document }, EARLIER_URL))
		expect(instance.migratedFrom).toBe(EARLIEST)
	})

	test.each(Object.keys(entryPoints))('strictSchema refuses an earlier inline part via %s, naming the part', (entry) => {
		const error = versionError(() => entryPoints[entry]!('bundle', packet(earlierChild), { strictSchema: true }))
		expect(error.code).toBe('outdated-version')
		expect(error.message).toContain('"notice"')
		expect(error.path).toEqual(['contents', 1, 'artifact', '$schema'])
	})

	test('a newer part of a nested inline bundle is refused at its path', () => {
		const nested = { kind: 'bundle', name: 'inner', contents: [{ type: 'inline', key: 'deep', artifact: { $schema: NEWER_URL, ...bodies.document } }] }
		const error = versionError(() => bundle.from(packet(nested)))
		expect(error.code).toBe('newer-version')
		expect(error.message).toContain('"deep"')
		expect(error.path).toEqual(['contents', 1, 'artifact', 'contents', 0, 'artifact', '$schema'])
	})

	test.each(Object.keys(entryPoints))('a part later than its earlier bundle is accepted via %s, each upgraded from its own date', (entry) => {
		const instance = entryPoints[entry]!('bundle', packet({ $schema: ASTERDOC_SCHEMA_URL, ...bodies.document }, EARLIER_URL))
		expect(instance.migratedFrom).toBe(PREVIOUS)
		expect(instance.toJSON().$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(partSchema(instance)).toBe(ASTERDOC_SCHEMA_URL)
		expect(validate(packet({ $schema: ASTERDOC_SCHEMA_URL, ...bodies.document }, EARLIER_URL)).issues).toBeUndefined()
	})

	test('a part on an unpublished date under an earlier bundle is refused, naming the part', () => {
		const error = versionError(() => bundle.from(packet({ $schema: 'https://schema.asterdoc.com/2026-11-01.json', ...bodies.document }, EARLIER_URL)))
		expect(error.code).toBe('unknown-version')
		expect(error.message).toContain('"notice"')
		expect(error.path).toEqual(['contents', 1, 'artifact', '$schema'])
	})

	test('validate() reports a strict refusal of a part at its path', () => {
		const result = validate(packet(earlierChild), { strictSchema: true })
		expect(result.issues?.[0]?.path).toEqual(['contents', 1, 'artifact', '$schema'])
	})
})

describe('migrate rewrites an earlier artifact for good', () => {
	test.each(KINDS)('an earlier %s migrates, and the result loads through every entry point as current', (kind) => {
		const result = migrateArtifact(withSchema(kind, EARLIER_URL), { steps })
		expect(result).toMatchObject({ status: 'migrated', from: PREVIOUS, to: SCHEMA_VERSION })
		for (const entry of Object.keys(entryPoints)) {
			const instance = entryPoints[entry]!(kind, result.artifact as Record<string, unknown>, { strictSchema: true })
			expect(instance.name).toBe(bodies[kind].name)
			expect(instance.migratedFrom).toBeUndefined()
		}
	})

	const oldForm = (schema?: string) => ({
		...(schema && { $schema: schema }),
		kind: 'form',
		name: 'order',
		parties: { buyer: { label: 'Buyer', multiple: true } },
	})
	const holding = (schema: string | undefined, artifact: Record<string, unknown>) => ({
		...(schema && { $schema: schema }),
		kind: 'bundle',
		name: 'packet',
		contents: [{ type: 'inline', key: 'order', artifact }],
	})
	const partOf = (artifact: Record<string, any>, ...keys: string[]) =>
		keys.reduce((current, key) => current.contents.find((item: any) => item.key === key).artifact, artifact)

	test('an earlier part two bundles deep migrates and is stamped current', () => {
		const source = holding(EARLIER_URL, { kind: 'bundle', name: 'inner', contents: [{ type: 'inline', key: 'deep', artifact: oldForm(EARLIER_URL) }] })
		const result = migrateArtifact(source, { steps })
		const deep = partOf(result.artifact, 'order', 'deep')
		expect(deep.$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(deep.parties.buyer).not.toHaveProperty('multiple')
		expect(bundle.from(result.artifact).name).toBe('packet')
	})

	test('a current bundle with an earlier part migrates the part', () => {
		const source = holding(ASTERDOC_SCHEMA_URL, oldForm(EARLIER_URL))
		const result = migrateArtifact(source, { steps })
		expect(result.status).toBe('migrated')
		const part = partOf(result.artifact, 'order')
		expect(part.$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(part.parties.buyer).not.toHaveProperty('multiple')
		expect(bundle.from(result.artifact, { strictSchema: true }).name).toBe('packet')
	})

	test('a part without $schema follows its bundle through the steps', () => {
		const result = migrateArtifact(holding(EARLIER_URL, oldForm()), { steps })
		const part = partOf(result.artifact, 'order')
		expect(part).not.toHaveProperty('$schema')
		expect(part.parties.buyer).not.toHaveProperty('multiple')
	})

	test('a current bundle whose parts are all current is left as it is', () => {
		const source = holding(ASTERDOC_SCHEMA_URL, { $schema: ASTERDOC_SCHEMA_URL, ...bodies.document })
		expect(migrateArtifact(source, { steps })).toMatchObject({ status: 'current', artifact: source })
	})

	test('a part later than its bundle migrates, and the bundle loads strictly', () => {
		const result = migrateArtifact(holding(EARLIER_URL, { $schema: ASTERDOC_SCHEMA_URL, ...bodies.document }), { steps })
		expect(result.status).toBe('migrated')
		expect(partOf(result.artifact, 'order').$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(bundle.from(result.artifact, { strictSchema: true }).name).toBe('packet')
	})

	test.each([
		['with no published version', 'https://schema.asterdoc.com/schema.json', ASTERDOC_SCHEMA_URL, 'unknown-version'],
	])('a part %s is refused, naming it', (_label, partSchema, bundleSchema, code) => {
		const error = (() => {
			try {
				migrateArtifact(holding(bundleSchema, { $schema: partSchema, ...bodies.document }), { steps })
			} catch (caught) {
				return caught
			}
		})()
		expect(error).toBeInstanceOf(SchemaMigrationError)
		expect((error as SchemaMigrationError).code).toBe(code)
		expect((error as SchemaMigrationError).message).toContain('"order"')
	})

	test('a newer artifact is refused with the SDK update message', () => {
		expect(() => migrateArtifact(withSchema('form', NEWER_URL))).toThrow('newer than this SDK knows; update @asterdoc/core')
	})
})
