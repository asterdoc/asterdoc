import { describe, expect, it, vi } from 'vitest'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/core'
import {
	executeGetArtifact,
	executeGetRegistry,
	executeRender,
	fetchRegistryArtifact,
	fetchRegistryIndex,
	GetArtifactOutputSchema,
	GetRegistryOutputSchema,
	MAX_INDEX_SIZE,
	RegistryArtifactError,
	SourceOperationSchema,
} from '../src'
import { registryFetch, registryFixture, sha256 } from './helpers/registry'

const REGISTRY = 'https://registry.example'

const w9 = (edition: { key: string; label: string; date?: string }, version: string) => ({
	$schema: ASTERDOC_SCHEMA_URL,
	kind: 'document' as const,
	name: 'w-9',
	version,
	edition,
	layers: { text: { kind: 'inline' as const, mimeType: 'text/plain', text: `W-9 ${edition.key} ${version}` } },
	defaultLayer: 'text',
})

const notice = (version: string) => ({
	$schema: ASTERDOC_SCHEMA_URL,
	kind: 'document' as const,
	name: 'notice',
	version,
	layers: { text: { kind: 'inline' as const, mimeType: 'text/plain', text: `Notice ${version}` } },
	defaultLayer: 'text',
})

const march = { key: '2024-03', label: 'Rev. March 2024', date: '2024-03' }
const october = { key: '2018-10', label: 'Rev. October 2018' }

/** The first file of each name is the default: current edition 2024-03, latest 1.1.0. */
const files = [
	{ artifact: w9(march, '1.1.0') },
	{ artifact: w9(march, '1.0.0') },
	{ artifact: w9(october, '2.0.0') },
	{ artifact: notice('1.1.0') },
	{ artifact: notice('1.0.0') },
]

const config = (extra: Record<string, string> = {}) => ({ fetch: vi.fn(registryFetch(REGISTRY, files, extra)) })

describe('registry manifest', () => {
	it('reads a manifest of up to 10 MB', async () => {
		expect(MAX_INDEX_SIZE).toBe(10 * 1024 * 1024)
		const index = await fetchRegistryIndex(REGISTRY, config().fetch)
		expect(index.items.map((item) => item.name)).toEqual(['w-9', 'notice'])
	})

	it('refuses a manifest in the old shape', async () => {
		const fetch = vi.fn(async () => Response.json({ artifactsPath: 'artifacts', items: [{ name: 'notice', path: 'notice.json' }] }))
		await expect(fetchRegistryIndex(REGISTRY, fetch)).rejects.toThrow(/Invalid registry index format/)
	})

	it('refuses a manifest whose file path leaves the registry', async () => {
		const { manifest } = registryFixture([{ artifact: notice('1.0.0'), path: '../outside/notice.json' }])
		const fetch = vi.fn(async () => Response.json(manifest))
		await expect(fetchRegistryIndex(REGISTRY, fetch)).rejects.toThrow(/Invalid registry index format/)
	})
})

describe('get_registry', () => {
	it('lists editions and versions without paths or checksums', async () => {
		const result = await executeGetRegistry({ registry_url: REGISTRY }, config())
		expect(result).toEqual({
			registry_url: REGISTRY,
			name: 'test-registry',
			items: [
				{
					name: 'w-9',
					kind: 'document',
					current_edition: '2024-03',
					editions: [
						{ key: '2024-03', label: 'Rev. March 2024', date: '2024-03', latest_version: '1.1.0', versions: ['1.1.0', '1.0.0'] },
						{ key: '2018-10', label: 'Rev. October 2018', latest_version: '2.0.0', versions: ['2.0.0'] },
					],
				},
				{ name: 'notice', kind: 'document', latest_version: '1.1.0', versions: ['1.1.0', '1.0.0'] },
			],
		})
		expect(GetRegistryOutputSchema.parse(result)).toEqual(result)
		expect(JSON.stringify(result)).not.toMatch(/sha256|\.json/)
	})

	it('reports a manifest it cannot read', async () => {
		const result = await executeGetRegistry({ registry_url: REGISTRY }, { fetch: vi.fn(async () => Response.json({ items: [{ name: 'notice' }] })) })
		expect(result.items).toEqual([])
		expect(result.error?.message).toMatch(/Invalid registry index format/)
	})
})

describe('get_artifact releases', () => {
	it('reads the current edition and latest version by default', async () => {
		const options = config()
		const result = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'w-9' }, options)
		expect(result.error).toBeUndefined()
		expect(result).toMatchObject({
			artifact_name: 'w-9',
			edition: '2024-03',
			version: '1.1.0',
			base_url: `${REGISTRY}/w-9/2024-03/1.1.0`,
			releases: { current_edition: '2024-03' },
		})
		expect(result.artifact).toEqual(w9(march, '1.1.0'))
		expect(result.releases?.editions?.map((edition) => edition.key)).toEqual(['2024-03', '2018-10'])
		expect(GetArtifactOutputSchema.parse(result)).toEqual(result)
		expect(options.fetch).toHaveBeenCalledWith(`${REGISTRY}/w-9/2024-03/1.1.0/w-9.json`, expect.anything())
	})

	it('reads a named edition and version, and treats current and latest as the defaults', async () => {
		const pinned = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'w-9', edition: '2024-03', version: '1.0.0' }, config())
		expect(pinned).toMatchObject({ edition: '2024-03', version: '1.0.0' })
		const older = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'w-9', edition: '2018-10' }, config())
		expect(older).toMatchObject({ edition: '2018-10', version: '2.0.0' })
		const selectors = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'w-9', edition: 'current', version: 'latest' }, config())
		expect(selectors).toMatchObject({ edition: '2024-03', version: '1.1.0' })
	})

	it('reads a version of an artifact that has no editions', async () => {
		const result = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'notice', version: '1.0.0' }, config())
		expect(result.error).toBeUndefined()
		expect(result.edition).toBeUndefined()
		expect(result.version).toBe('1.0.0')
		expect(result.releases).toEqual({ latest_version: '1.1.0', versions: ['1.1.0', '1.0.0'] })
	})

	it.each([
		['an unknown edition', { artifact_name: 'w-9', edition: '2030-01' }, 'w-9 has no edition 2030-01. Its editions: 2024-03, 2018-10 (current: 2024-03).'],
		['an unknown version', { artifact_name: 'w-9', version: '9.9.9' }, 'Edition 2024-03 of w-9 has no version 9.9.9. Its versions: 1.1.0, 1.0.0 (latest: 1.1.0).'],
		['an edition of an artifact that has none', { artifact_name: 'notice', edition: '2024-03' }, 'notice has no editions, so it has no edition 2024-03. Its versions: 1.1.0, 1.0.0.'],
	])('answers %s with what the registry lists', async (_label, input, message) => {
		const options = config()
		const result = await executeGetArtifact({ registry_url: REGISTRY, ...input }, options)
		expect(result.artifact).toBeUndefined()
		expect(result.error).toEqual({ code: 'release_not_found', message })
		// Only the manifest was read: a failed resolution fetches no file.
		expect(options.fetch).toHaveBeenCalledTimes(1)
	})

	it('answers an unknown artifact name', async () => {
		const result = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'other' }, config())
		expect(result.error?.code).toBe('artifact_not_found')
	})

	it('refuses an edition or version that is not a selector', async () => {
		const result = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'w-9', version: 'newest' }, config())
		expect(result.error?.code).toBe('invalid_input')
	})
})

describe('registry file checks', () => {
	const path = 'notice/1.1.0/notice.json'

	it('refuses a file whose bytes do not match the manifest checksum', async () => {
		const tampered = JSON.stringify({ ...notice('1.1.0'), defaultLayer: 'other' })
		const result = await executeGetArtifact({ registry_url: REGISTRY, artifact_name: 'notice' }, config({ [path]: tampered }))
		expect(result.artifact).toBeUndefined()
		expect(result.error?.code).toBe('integrity_mismatch')
		expect(result.error?.message).toContain(sha256(tampered))
		expect(result.error?.message).toContain(path)
	})

	it.each([
		['name', { ...notice('1.1.0'), name: 'other-notice' }, /name "notice".*states "other-notice"/],
		['version', notice('1.0.5'), /version "1.1.0".*states "1.0.5"/],
		['missing version', { ...notice('1.1.0'), version: undefined }, /version "1.1.0".*states none/],
	])('refuses a file that states another %s than the manifest', async (_label, artifact, message) => {
		// The manifest lists the checksum of this file, so only the identity check can refuse it.
		const { manifest } = registryFixture([{ artifact: notice('1.1.0') }])
		const body = JSON.stringify(artifact)
		const item = (manifest.items as Array<{ versions: Record<string, { sha256: string }> }>)[0]!
		item.versions['1.1.0']!.sha256 = sha256(body)
		const fetch = vi.fn(async (input: string) => new Response(input.endsWith('/registry.json') ? JSON.stringify(manifest) : body))
		await expect(fetchRegistryArtifact(REGISTRY, { name: 'notice' }, fetch)).rejects.toMatchObject({ code: 'identity_mismatch', message: expect.stringMatching(message) })
	})

	it('refuses a file that states another edition key than the manifest', async () => {
		const { manifest } = registryFixture([{ artifact: w9(march, '1.1.0') }])
		const body = JSON.stringify(w9(october, '1.1.0'))
		const item = (manifest.items as Array<{ editions: Record<string, { versions: Record<string, { sha256: string }> }> }>)[0]!
		item.editions['2024-03']!.versions['1.1.0']!.sha256 = sha256(body)
		const fetch = vi.fn(async (input: string) => new Response(input.endsWith('/registry.json') ? JSON.stringify(manifest) : body))
		const error = await fetchRegistryArtifact(REGISTRY, { name: 'w-9' }, fetch).catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(RegistryArtifactError)
		expect(error).toMatchObject({ code: 'identity_mismatch', message: expect.stringMatching(/edition key "2024-03".*states "2018-10"/) })
	})

	it('reads a YAML artifact file', async () => {
		const artifact = notice('1.1.0')
		const body = `name: notice\nkind: document\nversion: 1.1.0\n`
		const { manifest } = registryFixture([{ artifact, path: 'notice/notice.yaml' }])
		const item = (manifest.items as Array<{ versions: Record<string, { sha256: string }> }>)[0]!
		item.versions['1.1.0']!.sha256 = sha256(body)
		const fetch = vi.fn(async (input: string) => new Response(input.endsWith('/registry.json') ? JSON.stringify(manifest) : body))
		const fetched = await fetchRegistryArtifact(REGISTRY, { name: 'notice' }, fetch)
		expect(fetched.artifact).toEqual({ name: 'notice', kind: 'document', version: '1.1.0' })
		expect(fetched.baseUrl).toBe(`${REGISTRY}/notice`)
	})
})

describe('registry source', () => {
	it('renders a named edition and version', async () => {
		const result = await executeRender({ source: 'registry', registry_url: REGISTRY, artifact_name: 'w-9', edition: '2018-10', version: '2.0.0' }, config())
		expect(result).toMatchObject({ success: true, content: 'W-9 2018-10 2.0.0' })
	})

	it('answers a failed resolution with what the registry lists', async () => {
		const result = await executeRender({ source: 'registry', registry_url: REGISTRY, artifact_name: 'notice', version: '3.0.0' }, config())
		expect(result.success).toBe(false)
		expect(result.error).toMatchObject({ code: 'release_not_found', message: 'notice has no version 3.0.0. Its versions: 1.1.0, 1.0.0 (latest: 1.1.0).' })
	})

	it('refuses an edition or a version on a source that is not a registry', async () => {
		const parsed = SourceOperationSchema.safeParse({ source: 'url', url: 'https://example.com/notice.json', version: '1.0.0' })
		expect(parsed.success).toBe(false)
		expect(parsed.error?.issues[0]).toMatchObject({ path: ['version'], message: 'version is only allowed when source is "registry"' })
		const result = await executeRender({ source: 'artifact', artifact: notice('1.0.0'), edition: '2024-03' })
		expect(result.success).toBe(false)
		expect(result.error?.code).toBe('invalid_input')
	})
})
