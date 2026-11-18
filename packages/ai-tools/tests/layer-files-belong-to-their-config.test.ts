import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { artifactFileResolver, executeFill, executeRender } from '../src'
import { VERIFIED_FILE_LIMIT } from '../src/form-loader'
import { blankPdf } from './helpers/pdf-files'

const PDF = blankPdf() as Uint8Array<ArrayBuffer>
const CHECKSUM = `sha256:${createHash('sha256').update(PDF).digest('hex')}`

const permit = {
	kind: 'form',
	name: 'permit',
	version: '1.0.0',
	title: 'Permit',
	fields: { name: { type: 'text', label: 'Name' } },
	layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'permit.pdf', checksum: CHECKSUM } },
	defaultLayer: 'pdf',
}

function serving(status = 200) {
	const urls: string[] = []
	const fetch = (async (input: RequestInfo | URL) => {
		urls.push(String(input))
		return status === 200 ? new Response(PDF) : new Response('Forbidden', { status })
	}) as typeof globalThis.fetch
	return { urls, config: { fetch } }
}

const fill = (base: string, config: { fetch: typeof globalThis.fetch }) =>
	executeFill({ source: 'artifact', base_url: `https://files.asterdoc.dev/${base}/`, artifact: permit, data: { fields: { name: 'Ada' } } }, config)

describe('the layer files the tools keep', () => {
	it('are kept for the config that read them, and read again for another config', async () => {
		const first = serving()
		const second = serving()
		expect(await fill('shared', first.config)).toMatchObject({ accepted: true })
		expect(await fill('shared', first.config)).toMatchObject({ accepted: true })
		expect(await fill('shared', second.config)).toMatchObject({ accepted: true })
		expect(first.urls).toHaveLength(1)
		expect(second.urls).toHaveLength(1)
	})

	it('give a config whose fetch is refused no file another config read', async () => {
		await fill('tenant', serving().config)
		const refused = serving(403)
		const result = await fill('tenant', refused.config)
		expect(refused.urls).toHaveLength(1)
		expect(result).toMatchObject({ accepted: false, error: { code: 'layer_file_unreadable', retryable: true, message: expect.stringContaining('"permit.pdf"') } })
	})

	it('are copies: changing bytes a read returned does not change the next read', async () => {
		const { urls, config } = serving()
		const resolver = artifactFileResolver(permit, 'https://files.asterdoc.dev/copies/', config)!
		;(await resolver.read('permit.pdf')).fill(0)
		;(await resolver.read('permit.pdf')).fill(0)
		expect(await resolver.read('permit.pdf')).toEqual(PDF)
		expect(urls).toHaveLength(1)
	})

	it(`keep the ${VERIFIED_FILE_LIMIT} files read last, and read an older one again`, async () => {
		const paths = Array.from({ length: VERIFIED_FILE_LIMIT + 1 }, (_, index) => `page-${index}.pdf`)
		const artifact = { ...permit, layers: Object.fromEntries(paths.map((path) => [path, { kind: 'file', mimeType: 'application/pdf', path, checksum: CHECKSUM }])) }
		const { urls, config } = serving()
		const resolver = artifactFileResolver(artifact, 'https://files.asterdoc.dev/many/', config)!
		for (const path of paths) await resolver.read(path)
		await resolver.read(paths.at(-1)!)
		expect(urls).toHaveLength(paths.length)
		await resolver.read(paths[0]!)
		expect(urls).toHaveLength(paths.length + 1)
	})
})

describe('an artifact with a file layer and no base_url', () => {
	it.each([
		['document', { kind: 'document', name: 'notice', version: '1.0.0', title: 'Notice', layers: { md: { kind: 'file', mimeType: 'text/markdown', path: 'notice.md' } }, defaultLayer: 'md' }, {}],
		['checklist', { kind: 'checklist', name: 'steps', version: '1.0.0', title: 'Steps', items: [{ id: 'done', title: 'Done' }], layers: { md: { kind: 'file', mimeType: 'text/markdown', path: 'steps.md' } }, defaultLayer: 'md' }, { done: true }],
	])('gets the tool error that asks for base_url when it is a %s', async (_kind, artifact, data) => {
		const result = await executeRender({ source: 'artifact', artifact, data })
		expect(result).toMatchObject({ success: false, error: { code: 'layer_files_unreachable', message: expect.stringContaining('Give base_url') } })
		expect((result as { error: { message: string } }).error.message).not.toMatch(/a\.document|a\.checklist|resolver/)
	})
})
