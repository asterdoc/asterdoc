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

function pdfLayers(form: Form): Array<[string, Layer]> {
	return Object.entries((form.layers ?? {}) as Record<string, Layer>).filter(([, layer]) => layer.kind === 'file' && isPdfMimeType(layer.mimeType))
}

async function readLayerPrint(form: Form, key: string, layer: Layer, options: ArtifactInstanceOptions | undefined): Promise<PdfPrintProfile> {
	const bindings = resolveLayerBindings((form.layers ?? {}) as Record<string, Layer>, layer)
	let template
	try {
		template = await buildRendererLayer(key, layer, bindings, options?.resolver, 'artifact')
	} catch (error) {
		if (error instanceof LayerReadError || error instanceof UnboundResolverError || error instanceof LayerChecksumError) throw error
		throw new LayerReadError(key, (layer as { path: string }).path, error)
	}
	return await readPdfPrintProfile({
		template: template.content as Uint8Array,
		form,
		...(bindings && { bindings }),
		...(layer.format && { format: layer.format }),
		...(template.font && { layerFont: { bytes: template.font.content, source: template.font.path } }),
		...(template.standardFont && { standardFont: template.standardFont }),
	})
}

/**
 * Read every PDF layer of a form, with its declared font, into the profile
 * validation checks data against. A layer that cannot be read fails the load
 * as a render of it would: a missing resolver, a missing file, or a checksum
 * that does not match.
 */
export async function loadFormPrint(form: Form, options: ArtifactInstanceOptions | undefined): Promise<FormPrint> {
	const profiles = new Map<string, PdfPrintProfile>()
	for (const [key, layer] of pdfLayers(form)) profiles.set(key, await readLayerPrint(form, key, layer, options))
	return { profiles }
}

export async function loadEachLayerPrint(
	form: Form,
	options: ArtifactInstanceOptions | undefined,
): Promise<{ print: FormPrint; failures: ReadonlyMap<string, Error> }> {
	const profiles = new Map<string, PdfPrintProfile>()
	const failures = new Map<string, Error>()
	for (const [key, layer] of pdfLayers(form)) {
		try {
			profiles.set(key, await readLayerPrint(form, key, layer, options))
		} catch (error) {
			failures.set(key, error instanceof Error ? error : new Error(String(error)))
		}
	}
	return { print: { profiles }, failures }
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
 * A value a layer cannot render, in the one shape every Asterdoc API reports
 * it: the artifact `path`, `keyword` `"render"`, the problem `code`, the
 * `layer`, and the `pdf_field` that cannot hold the value.
 */
export interface RenderProblemReport {
	path: string
	keyword: 'render'
	code: string
	message: string
	layer: string
	pdf_field?: string
}

/**
 * Report one problem from `renderProblems(layer)` or a `RenderRefusedError`
 * in the shape every Asterdoc API returns it.
 */
export function renderProblemReport(problem: ValidationError): RenderProblemReport {
	return {
		path: problem.field,
		keyword: 'render',
		code: problem.code ?? 'unprintable',
		message: problem.message,
		layer: problem.layer ?? '',
		...(problem.pdfField !== undefined && { pdf_field: problem.pdfField }),
	}
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
