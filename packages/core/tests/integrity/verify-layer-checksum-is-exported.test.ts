import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { LayerChecksumError, verifyLayerChecksum } from '@/index'

const bytes = new TextEncoder().encode('%PDF-1.7 template')
const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`

describe('verifyLayerChecksum from the package entry', () => {
	test('accepts bytes that match the declared checksum', async () => {
		await expect(verifyLayerChecksum(bytes, checksum, 'pdf', 'form.pdf', 'layer')).resolves.toBeUndefined()
	})

	test('checks nothing when the layer declares no checksum', async () => {
		await expect(verifyLayerChecksum(bytes, undefined, 'pdf', 'form.pdf', 'layer')).resolves.toBeUndefined()
	})

	test('throws LayerChecksumError naming the layer, path, target and both digests on a mismatch', async () => {
		const tampered = new TextEncoder().encode('%PDF-1.7 tampered')
		const actual = `sha256:${createHash('sha256').update(tampered).digest('hex')}`
		const error = await verifyLayerChecksum(tampered, checksum, 'pdf', 'fonts/a.ttf', 'font').catch((e: unknown) => e)
		expect(error).toBeInstanceOf(LayerChecksumError)
		expect(error).toMatchObject({ layerKey: 'pdf', path: 'fonts/a.ttf', target: 'font', expected: checksum, actual })
	})
})
