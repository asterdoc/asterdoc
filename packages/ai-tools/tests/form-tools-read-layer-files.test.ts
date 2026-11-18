import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { executeFill, executeGetFillState, executeUpdateFill, executeValidateInput } from '../src'

function blankPdf(): Uint8Array<ArrayBuffer> {
	const bodies = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>',
	]
	let pdf = '%PDF-1.5\n'
	const offsets: number[] = []
	bodies.forEach((body, index) => {
		offsets.push(pdf.length)
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
	})
	const xref = pdf.length
	pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
	pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return new TextEncoder().encode(pdf) as Uint8Array<ArrayBuffer>
}

const PDF = blankPdf()
const CHECKSUM = `sha256:${createHash('sha256').update(PDF).digest('hex')}`

const permit = (layer: Record<string, unknown>) => ({
	kind: 'form',
	name: 'permit',
	version: '1.0.0',
	title: 'Permit',
	fields: { name: { type: 'text', label: 'Name', required: true } },
	layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'permit.pdf', ...layer } },
	defaultLayer: 'pdf',
})

function countingFetch() {
	const urls: string[] = []
	const fetch = (async (input: RequestInfo | URL) => {
		urls.push(String(input))
		return new Response(PDF)
	}) as typeof globalThis.fetch
	return { urls, config: { fetch } }
}

const data = { fields: { name: 'Ada' } }

describe('a form tool on a form with a PDF file layer', () => {
	it('asks for base_url, in the tool\'s own terms, when the form came inline without one', async () => {
		const artifact = permit({ checksum: CHECKSUM })
		const results = [
			await executeFill({ source: 'artifact', artifact, data }),
			await executeUpdateFill({ source: 'artifact', artifact, data, patch: { fields: { name: 'Grace' } } } as never),
			await executeGetFillState({ source: 'artifact', artifact, data }),
			await executeValidateInput({ source: 'artifact', artifact, target: 'field', field_path: 'name', value: 'Ada' }),
		]
		for (const result of results) {
			const error = (result as { error?: { code: string; message: string } }).error
			expect(error?.code).toBe('layer_files_unreachable')
			expect(error?.message).toContain('Give base_url')
			expect(error?.message).toContain('"permit.pdf"')
			expect(error?.message).not.toMatch(/form\.load|resolver/)
		}
	})

	it('loads a form with only inline layers without base_url', async () => {
		const artifact = { ...permit({}), layers: { text: { kind: 'inline', mimeType: 'text/plain', text: '{{fields.name}}' } }, defaultLayer: 'text' }
		expect(await executeFill({ source: 'artifact', artifact, data })).toMatchObject({ accepted: true, complete: true })
	})

	it('reads a file whose checksum it matched once, for every later call on the same base_url', async () => {
		const { urls, config } = countingFetch()
		const source = { source: 'artifact' as const, base_url: 'https://files.asterdoc.dev/permit-cached/', artifact: permit({ checksum: CHECKSUM }) }
		expect(await executeFill({ ...source, data }, config)).toMatchObject({ accepted: true })
		expect(await executeFill({ ...source, data }, config)).toMatchObject({ accepted: true })
		expect(await executeGetFillState({ ...source, data }, config)).not.toHaveProperty('error')
		expect(urls).toEqual(['https://files.asterdoc.dev/permit-cached/permit.pdf'])
	})

	it('reads the file again for another base_url, or when the form declares no checksum', async () => {
		const other = countingFetch()
		await executeFill({ source: 'artifact', base_url: 'https://files.asterdoc.dev/permit-other/', artifact: permit({ checksum: CHECKSUM }), data }, other.config)
		expect(other.urls).toEqual(['https://files.asterdoc.dev/permit-other/permit.pdf'])

		const unchecked = countingFetch()
		const source = { source: 'artifact' as const, base_url: 'https://files.asterdoc.dev/permit-unchecked/', artifact: permit({}), data }
		await executeFill(source, unchecked.config)
		await executeFill(source, unchecked.config)
		expect(unchecked.urls).toHaveLength(2)
	})

	it('keeps no file that does not match its checksum, and says the file is not the one the artifact declares', async () => {
		const { urls, config } = countingFetch()
		const source = { source: 'artifact' as const, base_url: 'https://files.asterdoc.dev/permit-wrong/', artifact: permit({ checksum: `sha256:${'0'.repeat(64)}` }), data }
		const first = await executeFill(source, config)
		await executeFill(source, config)
		expect(urls).toHaveLength(2)
		expect((first as { error?: { code: string } }).error?.code).toBe('layer_checksum_mismatch')
	})
})
