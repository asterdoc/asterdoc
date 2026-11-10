import type { Layer, SealIntegrity, UncoveredContent } from '@asterdoc/types'
import type { SchemaVersion } from '@asterdoc/schemas'
import { isReactLayerMimeType } from '@/rendering/renderer-registry'
import { CORE_VERSION } from '@/version'
import { canonicalJson } from './canonical-json'
import { digestOf } from './digest'

const encoder = new TextEncoder()

/**
 * The content hash of a definition: the `sha256:` digest of its RFC 8785
 * canonical JSON. Pass the definition as stored, at the schema version it
 * declares, never the form it was upgraded to in memory.
 */
export async function contentHashOf(stored: unknown): Promise<string> {
	return digestOf(encoder.encode(canonicalJson(stored)))
}

/** What drew a layer besides its own bytes: a renderer or an adapter supplied at render time. */
export interface LayerDrawing {
	renderer: boolean
	adapter: boolean
}

/**
 * What the content hash leaves out when a layer is drawn: its file when it
 * declares no checksum (or is a React module, which core never reads), its
 * font when that declares none, and a renderer or adapter supplied at render
 * time, which brings its own fonts.
 */
export function uncoveredByLayer(layerKey: string, layer: Layer, drawing: LayerDrawing): UncoveredContent[] {
	const uncovered: UncoveredContent[] = []
	if (layer.kind === 'file') {
		if (!layer.checksum || isReactLayerMimeType(layer.mimeType)) {
			uncovered.push({ kind: 'layer', layer: layerKey, path: layer.path })
		}
		if (layer.font && !layer.font.checksum) {
			uncovered.push({ kind: 'font', layer: layerKey, path: layer.font.path })
		}
	}
	if (drawing.renderer) uncovered.push({ kind: 'render-font', layer: layerKey, via: 'renderer' })
	if (drawing.adapter) uncovered.push({ kind: 'render-font', layer: layerKey, via: 'adapter' })
	return uncovered
}

/** The seal's record of a definition: its content hash, with the SDK version and `migratedFrom` beside it. */
export function sealIntegrity(
	contentHash: string,
	migratedFrom: SchemaVersion | undefined,
	uncovered: UncoveredContent[],
): SealIntegrity {
	return {
		contentHash,
		sdkVersion: CORE_VERSION,
		...(migratedFrom && { migratedFrom }),
		uncovered,
	}
}
