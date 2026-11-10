import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { SCHEMA_VERSIONS, type SchemaVersion } from '@asterdoc/schemas'
import { bundle, document } from '@/artifacts'
import { SchemaMigrationError, migrateArtifact, upgradeArtifact } from '@/migration'
import { SchemaVersionError, load } from '@/serialization'
import { validate } from '@/validation/artifact'

vi.mock('@/migration/steps', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/migration/steps')>()
	const { UnconvertibleValueError } = await import('@/migration/errors')
	const { SCHEMA_VERSION } = await import('@asterdoc/schemas')
	return {
		...actual,
		MIGRATION_STEPS: actual.MIGRATION_STEPS.map((step) =>
			step.to === SCHEMA_VERSION
				? {
						...step,
						apply: (artifact: Record<string, unknown>) => {
							if (artifact.title === 'Lossy') throw new UnconvertibleValueError(['title'], artifact.title, 'it has no lossless form at the new version')
							return step.apply(artifact)
						},
					}
				: step,
		),
	}
})

const PREVIOUS = SCHEMA_VERSIONS.at(-2) as SchemaVersion
const fixture = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', PREVIOUS, 'notice.json'), 'utf8')
const lossy = fixture.replace('"title": "Notice"', '"title": "Lossy"')

function versionError(run: () => unknown): SchemaVersionError {
	try {
		run()
	} catch (error) {
		if (error instanceof SchemaVersionError) return error
		throw error
	}
	throw new Error('Expected a SchemaVersionError')
}

describe('an upgrade a step cannot make without loss', () => {
	test('control: the stored fixture the step can convert loads upgraded', () => {
		expect(load(fixture).migratedFrom).toBe(PREVIOUS)
	})

	test('load refuses it, naming the version, the value and the reason', () => {
		const error = versionError(() => load(lossy))
		expect(error.code).toBe('not-upgradable')
		expect(error.path).toEqual(['$schema'])
		expect(error.message).toContain(`schema version ${PREVIOUS}`)
		expect(error.message).toContain('without loss')
		expect(error.message).toContain('title = "Lossy"')
	})

	test('every other entry refuses it too, and the input is left as it was', () => {
		const input = JSON.parse(lossy) as Record<string, unknown>
		const before = structuredClone(input)
		expect(versionError(() => document.from(input)).code).toBe('not-upgradable')
		expect(versionError(() => upgradeArtifact(input)).code).toBe('not-upgradable')
		const result = validate(input)
		expect(result.issues?.[0]?.path).toEqual(['$schema'])
		expect(result.issues?.[0]?.message).toContain('without loss')
		expect(input).toEqual(before)
	})

	test('a bundle holding it as an inline part is refused, naming the value', () => {
		const packet = { kind: 'bundle', name: 'packet', contents: [{ type: 'inline', key: 'notice', artifact: JSON.parse(lossy) }] }
		const error = versionError(() => bundle.from(packet))
		expect(error.code).toBe('not-upgradable')
		expect(error.path).toEqual(['contents', 0, 'artifact', '$schema'])
		expect(error.message).toContain('title = "Lossy"')
	})

	test('migrate refuses it with the step error', () => {
		expect(() => migrateArtifact(JSON.parse(lossy))).toThrow(SchemaMigrationError)
		expect(() => migrateArtifact(JSON.parse(lossy))).toThrow('title = "Lossy"')
	})
})
