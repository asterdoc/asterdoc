import { describe, expect, test, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION } from '@asterdoc/schemas'
import {
	SchemaMigrationError,
	UnconvertibleValueError,
	migrateArtifact,
	migrateArtifactSource,
	type ArtifactObject,
	type MigrationStep,
} from '@/migration'
import { validate } from '@/validation/artifact'
import { EARLIER, EARLIEST, earlierUrl } from '../schema-history'

vi.mock('@asterdoc/schemas', async (importOriginal) => {
	const { withEarlierVersions } = await import('../schema-history')
	return withEarlierVersions(await importOriginal())
})

type Json = Record<string, any>

function migrationError(run: () => unknown): SchemaMigrationError {
	try {
		run()
	} catch (error) {
		if (error instanceof SchemaMigrationError) return error
		throw error
	}
	throw new Error('Expected the migration to fail')
}

function eachArtifact(artifact: ArtifactObject, visit: (artifact: ArtifactObject) => void): void {
	visit(artifact)
	if (artifact.kind !== 'bundle' || !Array.isArray(artifact.contents)) return
	for (const item of artifact.contents as Json[]) {
		if (item?.type === 'inline' && item.artifact) eachArtifact(item.artifact, visit)
	}
}

const headingToTitle: MigrationStep = {
	from: EARLIEST,
	to: EARLIER,
	summary: 'Moves heading into title.',
	apply(artifact) {
		eachArtifact(artifact, (part) => {
			if (!('heading' in part)) return
			if (typeof part.heading !== 'string') throw new UnconvertibleValueError(['heading'], part.heading, 'a heading must be text')
			part.title = part.heading
			delete part.heading
		})
		return artifact
	},
}

const partyMultipleDropped: MigrationStep = {
	from: EARLIER,
	to: SCHEMA_VERSION,
	summary: 'Drops the party key multiple.',
	apply(artifact) {
		eachArtifact(artifact, (part) => {
			for (const party of Object.values((part.parties ?? {}) as Json)) delete party.multiple
		})
		return artifact
	},
}

const steps = [headingToTitle, partyMultipleDropped]

const current = { $schema: ASTERDOC_SCHEMA_URL, kind: 'document', name: 'notice' }
const earliest = { $schema: earlierUrl(EARLIEST), kind: 'document', name: 'notice', heading: 'Notice' }
const order = (schema?: string) => ({
	...(schema && { $schema: schema }),
	kind: 'form',
	name: 'order',
	parties: { buyer: { label: 'Buyer', multiple: true } },
})

describe('the chain of steps', () => {
	test('an artifact of every earlier version reaches the current one', () => {
		for (const version of [EARLIEST, EARLIER]) {
			const result = migrateArtifact({ ...current, $schema: earlierUrl(version) }, { steps })
			expect(result).toMatchObject({ status: 'migrated', from: version, to: SCHEMA_VERSION, artifact: { $schema: ASTERDOC_SCHEMA_URL } })
		}
	})

	test('applies every step in order, the result validates, and the input is never changed', () => {
		const source = { ...order(earlierUrl(EARLIEST)), heading: 'Order' }
		const result = migrateArtifact(source, { steps })
		if (result.status !== 'migrated') throw new Error('expected a migration')
		expect(result.steps.map((step) => step.summary)).toEqual(['Moves heading into title.', 'Drops the party key multiple.'])
		expect(result.artifact).toEqual({
			$schema: ASTERDOC_SCHEMA_URL,
			kind: 'form',
			name: 'order',
			parties: { buyer: { label: 'Buyer' } },
			title: 'Order',
		})
		expect(validate(result.artifact).issues).toBeUndefined()
		expect(source).toEqual({ ...order(earlierUrl(EARLIEST)), heading: 'Order' })
	})

	test('starts from the declared version', () => {
		const result = migrateArtifact(order(earlierUrl(EARLIER)), { steps })
		if (result.status !== 'migrated') throw new Error('expected a migration')
		expect(result.steps).toEqual([partyMultipleDropped])
	})

	test('the default steps are the published ones, which have no step from an earlier version', () => {
		const error = migrationError(() => migrateArtifact(earliest))
		expect(error.code).toBe('no-migration-path')
		expect(error.message).toContain(`${EARLIEST} to ${EARLIER}`)
	})

	test('a missing step fails naming the gap', () => {
		const error = migrationError(() => migrateArtifact(earliest, { steps: [headingToTitle] }))
		expect(error.code).toBe('no-migration-path')
		expect(error.message).toContain(`${EARLIER} to ${SCHEMA_VERSION}`)
	})

	test('a step that cannot convert a value names it', () => {
		const error = migrationError(() => migrateArtifact({ ...earliest, heading: 42 }, { steps }))
		expect(error.code).toBe('unconvertible-value')
		expect(error.message).toBe('Cannot convert heading = 42: a heading must be text')
	})

	test('a result that does not validate fails, naming the issue', () => {
		const keepsMultiple: MigrationStep = { ...partyMultipleDropped, apply: (artifact) => artifact }
		const error = migrationError(() => migrateArtifact(order(earlierUrl(EARLIER)), { steps: [headingToTitle, keepsMultiple] }))
		expect(error.code).toBe('invalid-result')
		expect(error.message).toContain('multiple')
	})
})

describe('inline parts of a bundle', () => {
	const holding = (schema: string | undefined, artifact: Record<string, unknown>) => ({
		...(schema && { $schema: schema }),
		kind: 'bundle',
		name: 'packet',
		contents: [{ type: 'inline', key: 'order', artifact }],
	})
	const partOf = (artifact: Json, ...keys: string[]) =>
		keys.reduce((bundle, key) => bundle.contents.find((item: Json) => item.key === key).artifact, artifact)

	test('a part without $schema follows its bundle through the steps', () => {
		const result = migrateArtifact(holding(earlierUrl(EARLIER), order()), { steps })
		const part = partOf(result.artifact, 'order')
		expect(part).not.toHaveProperty('$schema')
		expect(part.parties.buyer).not.toHaveProperty('multiple')
		expect(validate(result.artifact).issues).toBeUndefined()
	})

	test('an earlier part of a current bundle is migrated and stamped current', () => {
		const result = migrateArtifact(holding(ASTERDOC_SCHEMA_URL, order(earlierUrl(EARLIER))), { steps })
		expect(result.status).toBe('migrated')
		const part = partOf(result.artifact, 'order')
		expect(part.$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(part.parties.buyer).not.toHaveProperty('multiple')
	})

	test('a part two bundles deep takes the steps from its own version', () => {
		const deepPart = { ...order(earlierUrl(EARLIEST)), title: 'Order' }
		const inner = { kind: 'bundle', name: 'inner', contents: [{ type: 'inline', key: 'deep', artifact: { ...deepPart, heading: 'Order form' } }] }
		const result = migrateArtifact(holding(earlierUrl(EARLIER), inner), { steps })
		const deep = partOf(result.artifact, 'order', 'deep')
		expect(deep).toMatchObject({ $schema: ASTERDOC_SCHEMA_URL, title: 'Order form' })
		expect(deep).not.toHaveProperty('heading')
		expect(deep.parties.buyer).not.toHaveProperty('multiple')
	})

	test('a current bundle whose parts are all current is left as it is', () => {
		const source = holding(ASTERDOC_SCHEMA_URL, { ...current })
		expect(migrateArtifact(source, { steps })).toEqual({ status: 'current', version: SCHEMA_VERSION, artifact: source })
	})

	test.each([
		['later than its bundle', ASTERDOC_SCHEMA_URL, earlierUrl(EARLIER), 'version-conflict'],
		['with no published version', 'https://schema.asterdoc.com/schema.json', ASTERDOC_SCHEMA_URL, 'unknown-version'],
	])('a part %s is refused, naming it', (_label, partSchema, bundleSchema, code) => {
		const error = migrationError(() => migrateArtifact(holding(bundleSchema, { ...current, $schema: partSchema }), { steps }))
		expect(error.code).toBe(code)
		expect(error.message).toContain('"order"')
	})
})

describe('reading the source version', () => {
	test('a current artifact is left as it is', () => {
		expect(migrateArtifact(current)).toEqual({ status: 'current', version: SCHEMA_VERSION, artifact: current })
	})

	test('a dated individual schema address names its version', () => {
		const result = migrateArtifact({ ...current, $schema: earlierUrl(EARLIER, 'document') }, { steps })
		expect(result).toMatchObject({ status: 'migrated', from: EARLIER })
	})

	test('a missing $schema needs a named source version', () => {
		const { $schema: _, ...unversioned } = current
		const error = migrationError(() => migrateArtifact(unversioned))
		expect(error.code).toBe('missing-version')
		expect(error.message).toContain('asterdoc migrate --from <version>')
		const result = migrateArtifact(unversioned, { from: EARLIER, steps })
		expect(result).toMatchObject({ status: 'migrated', from: EARLIER, artifact: { $schema: ASTERDOC_SCHEMA_URL } })
	})

	test('an undated Asterdoc address needs a named source version', () => {
		const undated = { ...current, $schema: 'https://schema.asterdoc.com/schema.json' }
		const error = migrationError(() => migrateArtifact(undated))
		expect(error.code).toBe('missing-version')
		expect(error.message).toContain('asterdoc migrate --from <version>')
		expect(migrateArtifact(undated, { from: SCHEMA_VERSION })).toMatchObject({
			status: 'migrated',
			steps: [],
			artifact: { $schema: ASTERDOC_SCHEMA_URL },
		})
	})

	test('a named version that disagrees with $schema fails', () => {
		const error = migrationError(() => migrateArtifact(earliest, { from: EARLIER, steps }))
		expect(error.code).toBe('version-conflict')
		expect(error.message).toContain(EARLIEST)
	})

	test.each([
		['an unpublished date', 'https://schema.asterdoc.com/2030-01-01.json', '2030-01-01'],
		['a foreign address', 'https://example.com/schema.json', 'not an Asterdoc schema address'],
	])('%s is an unknown version', (_label, address, named) => {
		const error = migrationError(() => migrateArtifact({ ...current, $schema: address }))
		expect(error.code).toBe('unknown-version')
		expect(error.message).toContain(named)
		expect(migrateArtifact({ ...current, $schema: address }, { from: EARLIER, steps })).toMatchObject({
			status: 'migrated',
			from: EARLIER,
			artifact: { $schema: ASTERDOC_SCHEMA_URL },
		})
	})

	test('input that is not an artifact fails', () => {
		expect(migrationError(() => migrateArtifact(['form'])).code).toBe('not-an-artifact')
	})
})

describe('migrating file content', () => {
	const json = `${JSON.stringify(earliest, null, 2)}\n`
	const yaml = [
		`# yaml-language-server: $schema=${earlierUrl(EARLIEST)}`,
		`$schema: ${earlierUrl(EARLIEST)}`,
		'kind: document',
		'name: notice',
		'# The notice heading',
		'heading: Notice',
		'',
	].join('\n')

	test('JSON stays JSON with its indentation and trailing newline', () => {
		const result = migrateArtifactSource(json, { steps })
		if (result.status !== 'migrated') throw new Error('expected a migration')
		expect(result.content.startsWith(`{\n  "$schema": "${ASTERDOC_SCHEMA_URL}",\n  "kind": "document",`)).toBe(true)
		expect(result.content.endsWith('}\n')).toBe(true)
		expect(JSON.parse(result.content).title).toBe('Notice')
	})

	test('tab-indented JSON keeps its tabs', () => {
		const result = migrateArtifactSource(JSON.stringify(earliest, null, '\t'), { steps })
		expect(result.content).toContain('\n\t"$schema"')
		expect(result.content.endsWith('\n')).toBe(false)
	})

	test('YAML stays YAML, keeps its comments, and points the editor comment at the current version', () => {
		const result = migrateArtifactSource(yaml, { format: 'yaml', steps })
		if (result.status !== 'migrated') throw new Error('expected a migration')
		expect(result.content).toContain(`# yaml-language-server: $schema=${ASTERDOC_SCHEMA_URL}\n$schema: ${ASTERDOC_SCHEMA_URL}\n`)
		expect(result.content).not.toContain(EARLIEST)
		expect(result.content).toContain('name: notice\n')
		expect(parseYaml(result.content)).toEqual({ $schema: ASTERDOC_SCHEMA_URL, kind: 'document', name: 'notice', title: 'Notice' })
	})

	test('an editor comment on another host is left alone', () => {
		const foreign = yaml.replace(`=${earlierUrl(EARLIEST)}`, '=https://example.com/notice.json')
		const result = migrateArtifactSource(foreign, { format: 'yaml', steps })
		expect(result.content).toContain('# yaml-language-server: $schema=https://example.com/notice.json\n')
	})

	test('YAML without $schema gains it as the first key', () => {
		const result = migrateArtifactSource('# A notice\nkind: document\nname: notice\n', { from: SCHEMA_VERSION })
		expect(result.content).toBe(`# A notice\n$schema: ${ASTERDOC_SCHEMA_URL}\nkind: document\nname: notice\n`)
	})

	test('current content is returned unchanged', () => {
		const source = `$schema: ${ASTERDOC_SCHEMA_URL}\nkind: document\nname: notice\n`
		expect(migrateArtifactSource(source)).toEqual({ status: 'current', version: SCHEMA_VERSION, content: source })
	})

	test.each([
		['JSON', '{ "kind": ', 'json' as const],
		['YAML', 'kind: [form', 'yaml' as const],
	])('unparseable %s fails', (_label, source, format) => {
		const error = migrationError(() => migrateArtifactSource(source, { format }))
		expect(error.code).toBe('unparseable')
	})
})
