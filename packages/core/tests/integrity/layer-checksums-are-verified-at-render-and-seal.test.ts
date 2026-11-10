import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { a, sealBundle } from '@/index'
import { LayerChecksumError } from '@/integrity/checksum'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'artifacts', 'form', 'fixtures')
const template = new Uint8Array(readFileSync(join(fixtures, 'one-field-form.pdf')))
const font = new Uint8Array(readFileSync(join(fixtures, 'cyrillic-boxes.ttf')))
const checksumOf = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const tampered = (bytes: Uint8Array) => {
	const copy = Uint8Array.from(bytes)
	copy[copy.length - 1] = copy[copy.length - 1]! ^ 0xff
	return copy
}

const TEMPLATE = checksumOf(template)
const FONT = checksumOf(font)

const pdfForm = (checksums: { layer?: string; font?: string } = {}) => ({
	kind: 'form' as const,
	name: 'checked-form',
	version: '1.0.0',
	fields: { name: { type: 'text' as const, label: 'Name' } },
	parties: { signer: { label: 'Signer', partyType: 'person' as const, signature: { required: true } } },
	layers: {
		pdf: {
			kind: 'file' as const,
			mimeType: 'application/pdf',
			path: 'form.pdf',
			...(checksums.layer && { checksum: checksums.layer }),
			font: { path: 'fonts/cyrillic.ttf', ...(checksums.font && { checksum: checksums.font }) },
			bindings: { name: 'name' },
			signatures: {
				signature: { party: { role: 'signer' }, type: 'signature' as const, placement: { page: 1, x: 50, y: 50, width: 120, height: 30 } },
			},
		},
	},
	defaultLayer: 'pdf',
})

const files = (overrides: Record<string, Uint8Array> = {}) =>
	createMemoryResolver({ contents: { 'form.pdf': template, 'fonts/cyrillic.ttf': font, ...overrides } })

const draft = (checksums: { layer?: string; font?: string }, resolver = files()) =>
	a.form(pdfForm(checksums), { resolver })
		.fill({ fields: { name: 'Жук' }, parties: { signer: { id: 'signer-0', name: 'Ада' } } })
		.addSigner('ada', { person: { name: 'Ада' } })
		.addSignatory('signer', 'signer-0', { signerId: 'ada' })

async function failure(run: () => Promise<unknown>): Promise<LayerChecksumError> {
	const error = await run().then(() => undefined, (caught: unknown) => caught)
	expect(error).toBeInstanceOf(LayerChecksumError)
	return error as LayerChecksumError
}

describe('a file layer that declares checksums', () => {
	test('renders and seals when the template and font bytes match', async () => {
		const form = draft({ layer: TEMPLATE, font: FONT })
		expect(await form.render()).toBeInstanceOf(Uint8Array)
		expect((await form.seal()).canonicalPdfHash).toMatch(/^sha256:[a-f0-9]{64}$/)
	})

	test('fails the render of tampered template bytes, naming the layer and both digests', async () => {
		const bad = tampered(template)
		const error = await failure(() => draft({ layer: TEMPLATE, font: FONT }, files({ 'form.pdf': bad })).render())
		expect(error).toMatchObject({ layerKey: 'pdf', path: 'form.pdf', target: 'layer', expected: TEMPLATE, actual: checksumOf(bad) })
		expect(error.message).toContain('Layer "pdf" file "form.pdf" does not match its checksum')
		expect(error.message).toContain(TEMPLATE)
		expect(error.message).toContain(checksumOf(bad))
	})

	test('fails the seal of tampered template bytes', async () => {
		const error = await failure(() => draft({ layer: TEMPLATE }, files({ 'form.pdf': tampered(template) })).seal())
		expect(error.target).toBe('layer')
	})

	test('fails the render and the seal of tampered font bytes, naming the font and both digests', async () => {
		const bad = tampered(font)
		const resolver = files({ 'fonts/cyrillic.ttf': bad })
		const rendered = await failure(() => draft({ layer: TEMPLATE, font: FONT }, resolver).render())
		expect(rendered).toMatchObject({ layerKey: 'pdf', path: 'fonts/cyrillic.ttf', target: 'font', expected: FONT, actual: checksumOf(bad) })
		expect(rendered.message).toContain('The font of layer "pdf" ("fonts/cyrillic.ttf") does not match its checksum')
		const sealed = await failure(() => draft({ font: FONT }, resolver).seal())
		expect(sealed.target).toBe('font')
	})

	test('fails a definition-level render of tampered bytes too', async () => {
		const form = a.form(pdfForm({ layer: TEMPLATE }), { resolver: files({ 'form.pdf': tampered(template) }) })
		await failure(() => form.render({ data: { fields: { name: 'Жук' } } }))
	})

	test('fails the bundle seal of a part whose template was tampered with, naming the part', async () => {
		const bundle = { kind: 'bundle' as const, name: 'packet', contents: [{ key: 'form', type: 'path' as const, path: './form.json' }] }
		const failed = await sealBundle(bundle, {
			contents: { form: draft({ layer: TEMPLATE }, files({ 'form.pdf': tampered(template) })) },
		}).then(() => undefined, (caught: unknown) => caught as Error & { part?: string; cause?: unknown })
		expect(failed?.part).toBe('form')
		expect(failed?.cause).toBeInstanceOf(LayerChecksumError)
	})
})

describe('a file layer that declares no checksum', () => {
	test('renders and seals whatever bytes the resolver returns', async () => {
		const resolver = files({ 'form.pdf': tampered(template), 'fonts/cyrillic.ttf': font })
		await expect(draft({}, resolver).render()).resolves.toBeInstanceOf(Uint8Array)
		expect((await draft({}, resolver).seal()).phase).toBe('signable')
	})
})

describe('a text layer read from a file', () => {
	const notice = (checksum: string) =>
		a.document(
			{
				kind: 'document',
				name: 'notice',
				version: '1.0.0',
				layers: { body: { kind: 'file', mimeType: 'text/markdown', path: 'notice.md', checksum } },
				defaultLayer: 'body',
			},
			{ resolver: createMemoryResolver({ contents: { 'notice.md': new TextEncoder().encode('# Notice') } }) },
		)

	test('renders when its bytes match', async () => {
		await expect(notice(checksumOf(new TextEncoder().encode('# Notice'))).prepare().render()).resolves.toBe('# Notice')
	})

	test('fails when they do not, before they are decoded', async () => {
		const error = await failure(() => notice(checksumOf(new TextEncoder().encode('# Changed'))).prepare().render())
		expect(error).toMatchObject({ layerKey: 'body', path: 'notice.md', target: 'layer' })
	})
})
