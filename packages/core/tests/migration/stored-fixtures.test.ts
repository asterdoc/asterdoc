import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, SCHEMA_VERSIONS, type SchemaVersion } from '@asterdoc/schemas'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { inspectAcroFormFields } from '@asterdoc/render/pdf'
import { SchemaVersionError, load } from '@/serialization'
import { validate } from '@/validation/artifact'

const here = fileURLToPath(new URL('.', import.meta.url))
const fixtures = join(here, 'fixtures')
const pdf = new Uint8Array(readFileSync(join(here, '..', 'artifacts', 'form', 'fixtures', 'one-field-form.pdf')))
const resolver = createMemoryResolver({ contents: { './lease.pdf': pdf } })

const EARLIER_VERSIONS = SCHEMA_VERSIONS.filter((version) => version !== SCHEMA_VERSION)

const stored = (version: SchemaVersion) =>
	readdirSync(join(fixtures, version))
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => [file, readFileSync(join(fixtures, version, file), 'utf8')] as const)

function versionError(run: () => unknown): SchemaVersionError {
	try {
		run()
	} catch (error) {
		if (error instanceof SchemaVersionError) return error
		throw error
	}
	throw new Error('Expected a SchemaVersionError')
}

describe('stored artifacts from every earlier schema date', () => {
	test('every earlier published date has stored fixtures of every kind', () => {
		for (const version of EARLIER_VERSIONS) {
			expect(existsSync(join(fixtures, version)), version).toBe(true)
			const kinds = stored(version).map(([, content]) => (JSON.parse(content) as { kind: string }).kind).sort()
			expect(kinds, version).toEqual(['bundle', 'checklist', 'document', 'form'])
		}
	})

	describe.each(EARLIER_VERSIONS)('at %s', (version) => {
		test.each(stored(version))('%s declares its date and loads upgraded on the current SDK', (_file, content) => {
			expect((JSON.parse(content) as { $schema: string }).$schema).toBe(`https://schema.asterdoc.com/${version}.json`)
			const instance = load(content)
			expect(instance.migratedFrom).toBe(version)
			expect(instance.toJSON().$schema).toBe(ASTERDOC_SCHEMA_URL)
		})

		test.each(stored(version))('%s validates on the current SDK', (_file, content) => {
			expect(validate(JSON.parse(content)).issues).toBeUndefined()
		})

		test.each(stored(version))('%s is refused with strictSchema', (_file, content) => {
			expect(versionError(() => load(content, { strictSchema: true })).code).toBe('outdated-version')
			expect(validate(JSON.parse(content), { strictSchema: true }).issues?.[0]?.path).toEqual(['$schema'])
		})

		test.each(stored(version))('%s with a date newer than this SDK is refused', (_file, content) => {
			const newer = content.replace(`/${version}.json`, '/2999-01-01.json')
			const error = versionError(() => load(newer))
			expect(error.code).toBe('newer-version')
			expect(error.message).toContain('newer than this SDK knows; update @asterdoc/core')
		})

		test('the form fills and renders its inline and PDF layers', async () => {
			const instance = load<'form'>(new Map(stored(version)).get('lease.json') as string, { resolver })
			const draft = instance.fill({ fields: { tenant: 'Ada Lovelace', signed: '2026-03-04' } })
			expect(await draft.render()).toBe('Tenant Ada Lovelace signed on Mar 4, 2026.')
			const filled = await inspectAcroFormFields((await draft.render({ layer: 'pdf' })) as Uint8Array)
			const box = filled.find((field) => field.name === 'name')?.value
			expect(box).toBe(version === '2026-10-28' ? 'Mar 4, 2026' : '03/04/2026')
		})

		test('the document, checklist and bundle render or assemble', async () => {
			const byFile = new Map(stored(version))
			const notice = load<'document'>(byFile.get('notice.json') as string)
			expect(await notice.prepare().render()).toContain('The office closes at noon.')
			const checklist = load<'checklist'>(byFile.get('move-in.json') as string)
			expect(await checklist.fill({}).render()).toContain('Move-in checklist')
			const packet = load<'bundle'>(byFile.get('move-in-packet.json') as string)
			expect(packet.migratedFrom).toBe(version)
			expect(packet.contents.map((item) => item.key)).toEqual(['notice', 'move-in'])
		})
	})
})
