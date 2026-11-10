import { describe, expect, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, SCHEMA_VERSIONS, schemaVersionUrl, type SchemaVersion } from '@asterdoc/schemas'
import { form } from '@/artifacts'
import {
	LoadError,
	SchemaVersionError,
	load,
	loadFromObject,
	safeLoad,
	safeLoadFromObject,
} from '@/serialization'

const EARLIEST = SCHEMA_VERSIONS[0]
const EARLIER = SCHEMA_VERSIONS.at(-2) as SchemaVersion

const body = { kind: 'document', name: 'notice', title: 'Notice' }
const json = (schema?: unknown) => JSON.stringify(schema === undefined ? body : { $schema: schema, ...body })

function versionError(run: () => unknown): SchemaVersionError {
	try {
		run()
	} catch (error) {
		if (error instanceof SchemaVersionError) return error
		throw error
	}
	throw new Error('Expected a schema version error')
}

describe('loading an artifact file applies the schema version rule', () => {
	test('a current artifact loads from JSON and YAML', () => {
		expect(load(json(ASTERDOC_SCHEMA_URL)).name).toBe('notice')
		expect(load(`$schema: ${ASTERDOC_SCHEMA_URL}\nkind: document\nname: notice\n`).name).toBe('notice')
	})

	test('a missing $schema fails and names the current version and migrate', () => {
		const error = versionError(() => load(json()))
		expect(error.code).toBe('missing-version')
		expect(error).toBeInstanceOf(LoadError)
		expect(error.message).toContain(SCHEMA_VERSION)
		expect(error.message).toContain('asterdoc migrate')
	})

	test('an earlier version loads upgraded in memory, the content unchanged', () => {
		const content = json(schemaVersionUrl(EARLIER))
		const instance = load(content)
		expect(instance.migratedFrom).toBe(EARLIER)
		expect(instance.toJSON().$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(content).toBe(json(schemaVersionUrl(EARLIER)))
	})

	test('an earlier version with strictSchema fails naming it, the current version, and migrate', () => {
		const error = versionError(() => load(json(schemaVersionUrl(EARLIER)), { strictSchema: true }))
		expect(error.code).toBe('outdated-version')
		expect(error.found).toBe(schemaVersionUrl(EARLIER))
		expect(error.message).toContain(EARLIER)
		expect(error.message).toContain(SCHEMA_VERSION)
		expect(error.message).toContain('asterdoc migrate')
	})

	test('a newer version fails and asks for an SDK update', () => {
		const error = versionError(() => load(json('https://schema.asterdoc.com/2999-01-01.json')))
		expect(error.code).toBe('newer-version')
		expect(error.message).toContain('2999-01-01')
		expect(error.message).toContain('newer than this SDK knows; update @asterdoc/core')
	})

	test('a missing $schema fails even with an earlier version allowed', () => {
		expect(versionError(() => load(json(), { strictSchema: false })).code).toBe('missing-version')
	})

	test.each([
		['an unpublished earlier date', 'https://schema.asterdoc.com/2026-11-01.json', '2026-11-01'],
		['the undated address', 'https://schema.asterdoc.com/schema.json', 'schema.json'],
		['a foreign address', 'https://example.com/form.json', 'example.com'],
		['a non-string', 42, '42'],
	])('%s is an unknown version', (_label, address, named) => {
		const error = versionError(() => load(json(address)))
		expect(error.code).toBe('unknown-version')
		expect(error.message).toContain(named)
		expect(error.message).toContain(SCHEMA_VERSION)
		expect(error.message).toContain('asterdoc migrate')
	})

	test('safeLoad returns the version error rather than throwing', () => {
		const result = safeLoad(json(schemaVersionUrl(EARLIEST)), { strictSchema: true })
		expect(result.success).toBe(false)
		if (!result.success) expect(result.error).toBeInstanceOf(SchemaVersionError)
	})

	test('a kind that does not exist is reported before the version', () => {
		expect(() => load('kind: poster\nname: x\n')).toThrow(/Unknown artifact kind/)
	})
})

describe('loading a parsed object', () => {
	test('an object without $schema is an SDK artifact and loads', () => {
		expect(loadFromObject(body).name).toBe('notice')
	})

	test('an earlier $schema it declares is upgraded, and a readable one is required', () => {
		expect(loadFromObject({ $schema: schemaVersionUrl(EARLIER), ...body }).migratedFrom).toBe(EARLIER)
		expect(versionError(() => loadFromObject({ $schema: schemaVersionUrl(EARLIER), ...body }, { strictSchema: true })).code).toBe('outdated-version')
		const result = safeLoadFromObject({ $schema: 'https://schema.asterdoc.com/schema.json', ...body })
		expect(result.success).toBe(false)
		if (!result.success) expect(result.error).toBeInstanceOf(SchemaVersionError)
	})

	test('an SDK-built artifact loads with or without a serialized $schema', () => {
		const intake = form({ name: 'intake', fields: { name: { type: 'text' } } })
		expect(load(JSON.stringify(intake.toJSON())).name).toBe('intake')
		expect(load(intake.toYAML()).name).toBe('intake')
		expect(loadFromObject(intake.toJSON({ includeSchema: false })).name).toBe('intake')
	})
})
