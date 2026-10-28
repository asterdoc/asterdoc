import { describe, expect, it, vi } from 'vitest'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION } from '@asterdoc/core'
import { executeFill } from '../src/tools/fill'
import { executeGetArtifact } from '../src/tools/get-artifact'
import { registryFetch as serveRegistry } from './helpers/registry'

const form = (schema?: string) => ({
	...(schema ? { $schema: schema } : {}),
	kind: 'form',
	name: 'intake',
	version: '1.0.0',
	fields: { x: { type: 'text', label: 'X' } },
})

const UNPUBLISHED = 'https://schema.asterdoc.com/2025-01-01.json'

const registryFetch = (artifact: Record<string, unknown>) => vi.fn(serveRegistry('https://registry.example', [{ artifact }]))

const fillFromUrl = (artifact: unknown) =>
	executeFill(
		{ source: 'url', url: 'https://example.com/intake.json', data: { fields: { x: 'a' } } },
		{ fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(artifact))) },
	)

describe('AI tools apply the schema version rules', () => {
	it('fills a current artifact read from a URL', async () => {
		expect((await fillFromUrl(form(ASTERDOC_SCHEMA_URL))).accepted).toBe(true)
	})

	it.each([
		['missing', undefined, 'missing-version'],
		['unpublished', UNPUBLISHED, 'unknown-version'],
		['undated', 'https://schema.asterdoc.com/schema.json', 'unknown-version'],
	])('refuses a %s $schema read from a URL', async (_label, schema, code) => {
		const result = await fillFromUrl(form(schema))
		expect(result.accepted).toBe(false)
		expect(result.error?.code).toBe(code)
		expect(result.error?.message).toContain(SCHEMA_VERSION)
		expect(result.error?.message).toContain('asterdoc migrate')
	})

	it('refuses an artifact of another version from a registry', async () => {
		const result = await executeGetArtifact(
			{ registry_url: 'https://registry.example', artifact_name: 'intake' },
			{ fetch: registryFetch(form(UNPUBLISHED)) },
		)
		expect(result.artifact).toBeUndefined()
		expect(result.error?.code).toBe('unknown-version')
		expect(result.error?.message).toContain('2025-01-01')

		const current = await executeGetArtifact(
			{ registry_url: 'https://registry.example', artifact_name: 'intake' },
			{ fetch: registryFetch(form(ASTERDOC_SCHEMA_URL)) },
		)
		expect(current.artifact).toMatchObject({ name: 'intake' })
	})

	it('accepts an inline artifact without $schema but refuses one that declares another version', async () => {
		const plain = await executeFill({ source: 'artifact', artifact: form(), data: { fields: { x: 'a' } } })
		expect(plain.accepted).toBe(true)
		const other = await executeFill({ source: 'artifact', artifact: form(UNPUBLISHED), data: { fields: { x: 'a' } } })
		expect(other.accepted).toBe(false)
		expect(other.error?.code).toBe('unknown-version')
	})
})
