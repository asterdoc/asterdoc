import type { BinaryContent } from '@asterdoc/types'
import { digestOf } from './digest'

/** What a checksum belongs to: a file layer's own file, or the font it declares. */
export type ChecksumTarget = 'layer' | 'font'

/**
 * The bytes a resolver returned for a file layer, or for its font, do not
 * match the `checksum` the layer declares.
 */
export class LayerChecksumError extends Error {
	readonly layerKey: string
	readonly path: string
	readonly target: ChecksumTarget
	/** The checksum the layer declares. */
	readonly expected: string
	/** The digest of the bytes the resolver returned. */
	readonly actual: string

	constructor(layerKey: string, path: string, target: ChecksumTarget, expected: string, actual: string) {
		const subject = target === 'layer' ? `Layer "${layerKey}" file "${path}"` : `The font of layer "${layerKey}" ("${path}")`
		super(
			`${subject} does not match its checksum: the layer declares ${expected}, but the resolver returned bytes ` +
				`with ${actual}. Restore the file the checksum was recorded for, or record the new file's checksum.`,
		)
		this.name = 'LayerChecksumError'
		this.layerKey = layerKey
		this.path = path
		this.target = target
		this.expected = expected
		this.actual = actual
	}
}

/**
 * Check bytes a resolver returned against the checksum their layer declares.
 * A layer that declares no checksum is not checked.
 *
 * @throws {LayerChecksumError} when the bytes do not match.
 */
export async function verifyLayerChecksum(
	bytes: BinaryContent,
	expected: string | undefined,
	layerKey: string,
	path: string,
	target: ChecksumTarget,
): Promise<void> {
	if (expected === undefined) return
	const actual = await digestOf(bytes)
	if (actual !== expected) throw new LayerChecksumError(layerKey, path, target, expected, actual)
}
