import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { createLayerRenderer } from '@asterdoc/render'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import type { Bundle, SealAdapter } from '@asterdoc/types'
import { a, runtimeFormFromJSON, SealConfigError, sealBundle } from '@/index'
import { canonicalJson } from '@/integrity/canonical-json'
import { contentHashOf } from '@/integrity/seal-integrity'
import { CORE_VERSION } from '@/version'

const formFixtures = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'artifacts', 'form', 'fixtures')
const template = new Uint8Array(readFileSync(join(formFixtures, 'one-field-form.pdf')))
const font = new Uint8Array(readFileSync(join(formFixtures, 'cyrillic-boxes.ttf')))
const contract = new Uint8Array(readFileSync(join(formFixtures, 'large-contract.pdf')))
const checksumOf = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const adapter: SealAdapter = { convert: async () => ({ pdf: contract }) }

const pdfForm = (checksums: { layer?: string; font?: string }) => ({
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

const resolver = createMemoryResolver({
	contents: { 'form.pdf': template, 'fonts/cyrillic.ttf': font, 'body.md': new TextEncoder().encode('Hello') },
})

const pdfDraft = (checksums: { layer?: string; font?: string }) =>
	a.form(pdfForm(checksums), { resolver })
		.fill({ fields: { name: 'Жук' }, parties: { signer: { id: 'signer-0', name: 'Ада' } } })
		.addSigner('ada', { person: { name: 'Ада' } })
		.addSignatory('signer', 'signer-0', { signerId: 'ada' })

const markdownForm = (schema?: string) => ({
	...(schema && { $schema: schema }),
	kind: 'form' as const,
	name: 'letter',
	version: '1.0.0',
	fields: { a: { type: 'text' as const, label: 'A' } },
	parties: { client: { label: 'Client', partyType: 'person' as const, signature: { required: true } } },
	layers: { body: { kind: 'file' as const, mimeType: 'text/markdown', path: 'body.md' } },
	defaultLayer: 'body',
})

const markdownDraft = (definition: object) =>
	a.form.from(definition, { resolver })
		.fill({ fields: { a: 'x' }, parties: { client: { id: 'client-0', name: 'C' } } })
		.addSigner('sg', { person: { name: 'C' } })
		.addSignatory('client', 'client-0', { signerId: 'sg' })

describe('a form seal records its definition', () => {
	test('with the content hash, the SDK version, and nothing uncovered when every byte has a checksum', async () => {
		const draft = pdfDraft({ layer: checksumOf(template), font: checksumOf(font) })
		expect(draft.integrity).toBeUndefined()
		const sealed = await draft.seal()
		expect(sealed.integrity).toEqual({ contentHash: await draft.contentHash(), sdkVersion: CORE_VERSION, uncovered: [] })
	})

	test('listing a layer file and a font with no checksum as uncovered', async () => {
		const sealed = await pdfDraft({}).seal()
		expect(sealed.integrity?.uncovered).toEqual([
			{ kind: 'layer', layer: 'pdf', path: 'form.pdf' },
			{ kind: 'font', layer: 'pdf', path: 'fonts/cyrillic.ttf' },
		])
	})

	test('listing a renderer supplied at seal time, which brings its own fonts', async () => {
		const covered = { layer: checksumOf(template), font: checksumOf(font) }
		const overridden = await pdfDraft(covered).seal({ renderer: createLayerRenderer() })
		expect(overridden.integrity?.uncovered).toEqual([{ kind: 'render-font', layer: 'pdf', via: 'renderer' }])
		const registered = await pdfDraft(covered).seal({ renderers: { 'application/pdf': createLayerRenderer() } })
		expect(registered.integrity?.uncovered).toEqual([{ kind: 'render-font', layer: 'pdf', via: 'renderer' }])
	})

	test('listing the adapter that converted a text layer', async () => {
		const sealed = await markdownDraft(markdownForm()).seal({ adapter })
		expect(sealed.integrity?.uncovered).toEqual([
			{ kind: 'layer', layer: 'body', path: 'body.md' },
			{ kind: 'render-font', layer: 'body', via: 'adapter' },
		])
	})

	test('with migratedFrom beside the hash of the definition as stored at its earlier date', async () => {
		const stored = markdownForm('https://schema.asterdoc.com/2026-11-06.json')
		const sealed = await markdownDraft(stored).seal({ adapter })
		expect(sealed.integrity?.migratedFrom).toBe('2026-11-06')
		expect(sealed.integrity?.contentHash).toBe(`sha256:${createHash('sha256').update(canonicalJson(stored)).digest('hex')}`)
		expect(sealed.migratedFrom).toBe('2026-11-06')
	})

	test('listing a React module, whose bytes core never reads, even when it declares a checksum', async () => {
		const react = {
			...markdownForm(),
			layers: { body: { kind: 'file' as const, mimeType: 'text/tsx', path: 'letter.tsx', checksum: checksumOf(contract) } },
		}
		const sealed = await markdownDraft(react).seal({ renderers: { 'text/tsx': { id: 'letter', render: async () => contract } } })
		expect(sealed.integrity?.uncovered).toEqual([
			{ kind: 'layer', layer: 'body', path: 'letter.tsx' },
			{ kind: 'render-font', layer: 'body', via: 'renderer' },
		])
	})

	test('and keeps the record through toJSON, restore and finalize', async () => {
		const sealed = await pdfDraft({}).seal()
		const json = roundTrip(sealed.toJSON())
		expect('integrity' in json && json.integrity).toEqual(sealed.integrity)
		const restored = runtimeFormFromJSON(json, { resolver })
		expect(restored.integrity).toEqual(sealed.integrity)
		if (restored.phase !== 'signable') throw new Error('expected a signable form')
		const executed = restored.captureSignature('signer', 'signer-0', 'ada', 'signature').finalize()
		expect(executed.phase).toBe('executed')
		expect(executed.integrity).toEqual(sealed.integrity)
		expect(roundTrip(executed.toJSON())).toMatchObject({ integrity: sealed.integrity })
	})
})

describe('a bundle seal records its definition and each part', () => {
	const bundle: Bundle = {
		kind: 'bundle',
		name: 'packet',
		version: '1.0.0',
		contents: [
			{ key: 'form', type: 'path', path: './form.json' },
			{ key: 'scan', type: 'path', path: './scan.pdf' },
		],
	}

	test('with the hash its instance gives, a record per artifact part, none for an annex, and the annex uncovered', async () => {
		const draft = pdfDraft({ layer: checksumOf(template), font: checksumOf(font) })
		const packet = await sealBundle(bundle, {
			contents: { form: draft, scan: { kind: 'bytes', content: contract, mimeType: 'application/pdf' } },
		})
		expect(packet.integrity).toEqual({
			contentHash: await a.bundle(bundle).contentHash(),
			sdkVersion: CORE_VERSION,
			uncovered: [{ kind: 'annex', part: 'scan' }],
		})
		const [formPart, scanPart] = packet.parts
		expect(formPart?.integrity).toEqual({ contentHash: await draft.contentHash(), sdkVersion: CORE_VERSION, uncovered: [] })
		expect(scanPart?.integrity).toBeUndefined()
	})

	test('listing what the hashes do not cover in every part, naming the part', async () => {
		const packet = await sealBundle(bundle, {
			contents: { form: pdfDraft({}), scan: { kind: 'bytes', content: contract, mimeType: 'application/pdf' } },
		})
		expect(packet.parts[0]?.integrity?.uncovered).toEqual([
			{ kind: 'layer', layer: 'pdf', path: 'form.pdf' },
			{ kind: 'font', layer: 'pdf', path: 'fonts/cyrillic.ttf' },
		])
		expect(packet.integrity.uncovered).toEqual([
			{ kind: 'layer', layer: 'pdf', path: 'form.pdf', part: 'form' },
			{ kind: 'font', layer: 'pdf', path: 'fonts/cyrillic.ttf', part: 'form' },
			{ kind: 'annex', part: 'scan' },
		])
	})

	test('listing the renderer that drew a part it rendered rather than sealed', async () => {
		const unsigned = pdfForm({ layer: checksumOf(template), font: checksumOf(font) })
		const { signatures: _slots, ...layer } = unsigned.layers.pdf
		const rendered = a.form({ ...unsigned, layers: { pdf: layer } }, { resolver }).fill({ fields: { name: 'Жук' } })
		const packet = await sealBundle(bundle, {
			renderers: { 'application/pdf': createLayerRenderer() },
			contents: { form: rendered, scan: { kind: 'bytes', content: contract, mimeType: 'application/pdf' } },
		})
		expect(packet.parts[0]?.kind).toBe('rendered')
		expect(packet.parts[0]?.integrity?.uncovered).toEqual([{ kind: 'render-font', layer: 'pdf', via: 'renderer' }])
	})

	test('refuses a bundle with no canonical JSON form before it seals any part', async () => {
		const draft = pdfDraft({})
		const prepareSeal = vi.spyOn(draft, 'prepareSeal')
		const failure = await sealBundle({ ...bundle, title: 'Packet \ud800' } as Bundle, {
			contents: { form: draft, scan: { kind: 'bytes', content: contract, mimeType: 'application/pdf' } },
		}).then(() => undefined, (error: unknown) => error)
		expect(failure).toBeInstanceOf(SealConfigError)
		expect((failure as Error).message).toMatch(/^Cannot seal bundle: the bundle definition has no canonical JSON form: .*lone surrogate/)
		expect(prepareSeal).not.toHaveBeenCalled()
	})

	test('with migratedFrom for a bundle written for an earlier schema date', async () => {
		const earlier = { ...bundle, $schema: 'https://schema.asterdoc.com/2026-11-06.json' } as Bundle
		const packet = await sealBundle(earlier, {
			contents: { form: pdfDraft({}), scan: { kind: 'bytes', content: contract, mimeType: 'application/pdf' } },
		})
		expect(packet.integrity.migratedFrom).toBe('2026-11-06')
		expect(packet.integrity.contentHash).toBe(await contentHashOf(earlier))
		expect(packet.integrity.contentHash).toBe(await a.bundle.from(earlier).contentHash())
		expect(packet.bundle).toBe(earlier)
	})
})
