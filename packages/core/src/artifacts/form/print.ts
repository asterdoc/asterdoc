import type { Form, FormData, Formatter, Layer, RendererExpressions } from '@asterdoc/types'
import { isPdfMimeType } from '@asterdoc/schemas'
import { resolveLayerBindings } from '@asterdoc/render'
import { pdfPrintFailures, readPdfPrintProfile, type PdfPrintProfile } from '@asterdoc/render/pdf'
import type { ValidationError } from '@/types'
import { buildRendererLayer, LayerReadError, UnboundResolverError, type ArtifactInstanceOptions } from '../shared/render-layer'
import { LayerChecksumError } from '@/integrity/checksum'

export { LayerReadError }

/**
 * What a loaded form prints with: a print profile for each PDF layer, which
 * the render check of the layer reads.
 */
export interface FormPrint {
	readonly profiles: ReadonlyMap<string, PdfPrintProfile>
}

/**
 * Read every PDF layer of a form, with its declared font, into the profile
 * validation checks data against. A layer that cannot be read fails the load
 * as a render of it would: a missing resolver, a missing file, or a checksum
 * that does not match.
 */
export async function loadFormPrint(form: Form, options: ArtifactInstanceOptions | undefined): Promise<FormPrint> {
	const layers = (form.layers ?? {}) as Record<string, Layer>
	const profiles = new Map<string, PdfPrintProfile>()
	for (const [key, layer] of Object.entries(layers)) {
		if (layer.kind !== 'file' || !isPdfMimeType(layer.mimeType)) continue
		const bindings = resolveLayerBindings(layers, layer)
		let template
		try {
			template = await buildRendererLayer(key, layer, bindings, options?.resolver, 'artifact')
		} catch (error) {
			if (error instanceof LayerReadError || error instanceof UnboundResolverError || error instanceof LayerChecksumError) throw error
			throw new LayerReadError(key, layer.path, error)
		}
		profiles.set(key, await readPdfPrintProfile({
			template: template.content as Uint8Array,
			form,
			...(bindings && { bindings }),
			...(layer.format && { format: layer.format }),
			...(template.font && { layerFont: { bytes: template.font.content, source: template.font.path } }),
			...(template.standardFont && { standardFont: template.standardFont }),
		}))
	}
	return { profiles }
}

/**
 * Each value the PDF layer `layer` would refuse to print, as an error naming
 * the layer, the PDF field and the artifact path. A layer that is not a PDF
 * layer has no profile, and gives none.
 */
export function printErrors(print: FormPrint, layer: string, data: FormData, expressions: RendererExpressions, formatter?: Formatter): ValidationError[] {
	const profile = print.profiles.get(layer)
	if (!profile) return []
	return pdfPrintFailures(profile, { data: data as unknown as Record<string, unknown>, expressions, ...(formatter && { formatter }) }).map((failure) => ({
		field: failure.paths[0] ?? `layers.${layer}`,
		message: `Layer "${layer}": ${failure.message}`,
		code: 'unprintable',
		layer,
		...(failure.field && { pdfField: failure.field }),
	}))
}

/**
 * A render that refused before drawing: the data is valid, but some values
 * do not fit the layer. `problems` is the report `renderProblems(layer)`
 * gives, one entry per value, naming the field, the layer and the PDF field.
 */
export class RenderRefusedError extends Error {
	readonly layer: string
	readonly problems: readonly ValidationError[]

	constructor(layer: string, problems: readonly ValidationError[]) {
		super(`Cannot render layer "${layer}": ${problems.map((problem) => problem.message.replace(`Layer "${layer}": `, '')).join('; ')}`)
		this.name = 'RenderRefusedError'
		this.layer = layer
		this.problems = problems
	}
}
