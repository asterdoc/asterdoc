/**
 * Layer Rendering - Shared layer resolution and rendering logic
 *
 * This extracts the common render logic that was duplicated across
 * DocumentInstance, DraftDocument, and FinalDocument.
 */

import type {
	Bindings,
	ChecklistRenderRequest,
	DocumentRenderRequest,
	FormRenderRequest,
	FormatterProgressivePolicy,
	Formatter,
	Layer,
	AsterdocRenderer,
	RendererLayer,
	Resolver,
} from '@asterdoc/types'
import type { SchemaReadOptions } from '@/migration/upgrade'
import { createLayerRenderer, resolveLayerBindings } from '@asterdoc/render'
import {
	findRegisteredRenderer,
	InlineReactLayerError,
	isReactLayerMimeType,
	UnregisteredLayerRendererError,
	type RendererRegistry,
} from '@/rendering/renderer-registry'
import { verifyLayerChecksum } from '@/integrity/checksum'

/**
 * Runtime wiring bound to an artifact instance when it is constructed.
 *
 * A file-backed layer's bytes come from a resolver, and the resolver is bound
 * once: `await a.form.load(definition, { resolver })`. Every instance derived from that
 * one — every fill, every mutator, every clone — carries it. There is no
 * per-call resolver, because a runtime artifact is immutable by
 * reconstruction: a mutator builds a fresh instance from the config, and a
 * resolver that arrived with a render call would not survive the next one.
 */
export interface ArtifactInstanceOptions extends SchemaReadOptions {
	/** Reads the bytes of this artifact's file-backed layers. */
	resolver?: Resolver
}

/**
 * What an artifact instance's own `render` accepts. The resolver is not here:
 * it is bound at construction. See {@link ArtifactInstanceOptions}.
 */
export interface ArtifactLayerRenderOptions {
	/** Override the target layer for this render call. */
	layer?: string
	/** Formatter policy carried into registered renderers for this artifact render. */
	formatter?: Formatter
	/** Explicit missing/incomplete value policy for progressive previews. */
	progressive?: FormatterProgressivePolicy
	/**
	 * Renderers keyed by layer MIME type. A layer whose type has an entry
	 * renders through it instead of returning its raw content, which is how a
	 * format core does not ship — a React composition — reaches a render call
	 * that otherwise only resolves bytes.
	 */
	renderers?: RendererRegistry
}

/**
 * Options for the free `renderLayer` primitive, which reads a bare layers
 * record rather than an artifact instance and so is handed the resolver
 * directly.
 */
export interface LayerRenderOptions extends ArtifactLayerRenderOptions {
	/** Reads the bytes of a file-backed layer. */
	resolver?: Resolver
}

/**
 * Where the missing resolver was meant to come from.
 *
 * `artifact` is a render or seal on an artifact instance, whose resolver is
 * bound at construction. `layers` is one of the free primitives below, which
 * read a bare layers record with no artifact to have bound anything, and so
 * are handed the resolver in their own options.
 */
export type ResolverBindingSite = 'artifact' | 'layers'

/** How each site says the resolver should have arrived. */
const REMEDY: Record<ResolverBindingSite, string> = {
	artifact:
		'no resolver is bound to this artifact. Bind one where the artifact is loaded or constructed: ' +
		'form.load(definition, { resolver }), or the second argument to a.document or a.checklist, ' +
		'so every instance derived from it carries the resolver.',
	layers:
		'this call was given no resolver. `renderLayer` reads a bare layers record rather than an ' +
		'artifact, so there is nothing a resolver could have been bound to: pass one in its options.',
}

/**
 * A file-backed layer was rendered with no resolver to read its bytes.
 *
 * The remedy depends on where the render started, so `site` chooses it: an
 * artifact instance carries a resolver bound at construction, while the free
 * `renderLayer` primitive is handed one per call.
 */
export class UnboundResolverError extends Error {
	readonly layerKey: string
	readonly path: string
	readonly site: ResolverBindingSite

	constructor(layerKey: string, path: string, site: ResolverBindingSite) {
		super(`Layer "${layerKey}" is file-backed ("${path}") but ${REMEDY[site]}`)
		this.name = 'UnboundResolverError'
		this.layerKey = layerKey
		this.path = path
		this.site = site
	}
}

/**
 * Resolves the target layer key from available options.
 *
 * Priority:
 * 1. Explicit layer option
 * 2. Provided targetLayer
 * 3. Provided defaultLayer
 * 4. First available layer key
 *
 * @param layers - The layers record
 * @param targetLayer - Current target layer
 * @param defaultLayer - Default layer from artifact
 * @param options - Render options with optional layer override
 * @returns Resolved layer key
 * @throws Error if no layer can be resolved
 */
export function resolveLayerKey(
	layers: Record<string, Layer> | undefined,
	targetLayer: string | undefined,
	defaultLayer: string | undefined,
	options?: LayerRenderOptions,
): string {
	if (!layers || Object.keys(layers).length === 0) {
		throw new Error('No layers defined')
	}

	const key = options?.layer || targetLayer || defaultLayer || Object.keys(layers)[0]

	if (!key) {
		throw new Error(
			'No layer key provided and no defaultLayer set. ' +
				'Either pass a layer option or set defaultLayer on the artifact.',
		)
	}

	if (!layers[key]) {
		throw new Error(`Layer "${key}" not found. Available layers: ${Object.keys(layers).join(', ')}`)
	}

	return key
}

/**
 * The artifact a render request names, with the payload of its kind: the part
 * of a `RenderRequest` that is not the layer or the renderer context.
 */
export type RenderSubject =
	| Omit<FormRenderRequest, 'template' | 'ctx'>
	| Omit<ChecklistRenderRequest, 'template' | 'ctx'>
	| Omit<DocumentRenderRequest, 'template' | 'ctx'>

/**
 * What a renderer needs beyond the layer itself: the artifact that declares
 * the layer, with its payload, and the formatter policy of the render.
 */
export interface LayerRenderContext {
	/** The artifact that declares the layer, with the payload of its kind. */
	subject: RenderSubject
	/** Formatter policy selected for the containing artifact render. */
	formatter?: Formatter
	/** Explicit missing/incomplete value policy for progressive previews. */
	progressive?: FormatterProgressivePolicy
}

/**
 * Renders one layer from a layers record.
 *
 * A layer whose MIME type has an entry in `renderers` renders through it and
 * the result is returned. Everything else resolves to content: an inline
 * layer's text, or the bytes a resolver reads for a file layer, decoded for
 * text-based types.
 *
 * A React layer has no content to resolve, so with nothing registered for it
 * this fails naming the layer and the option rather than handing back the
 * module's source.
 *
 * @throws {UnregisteredLayerRendererError} when a React layer has no renderer.
 */
export async function renderLayer(
	layers: Record<string, Layer> | undefined,
	layerKey: string,
	options?: LayerRenderOptions,
	context?: LayerRenderContext,
): Promise<string | Uint8Array> {
	return renderLayerAt(layers, layerKey, 'layers', options, context)
}

/**
 * The body of `renderLayer`, told which remedy a missing resolver should name.
 *
 * The site is not an option, because it is not the caller's to choose: it is
 * decided by which entry point was reached. Everything public here reads a
 * bare layers record and passes `layers`; an artifact rendering its own layer
 * reaches this through `resolveAndRenderArtifactLayer` and passes `artifact`.
 */
async function renderLayerAt(
	layers: Record<string, Layer> | undefined,
	layerKey: string,
	site: ResolverBindingSite,
	options?: LayerRenderOptions,
	context?: LayerRenderContext,
): Promise<string | Uint8Array> {
	if (!layers) {
		throw new Error('No layers defined')
	}

	const layerSpec = layers[layerKey]
	if (!layerSpec) {
		throw new Error(`Layer "${layerKey}" not found. Available layers: ${Object.keys(layers).join(', ')}`)
	}

	const registered = findRegisteredRenderer(options?.renderers, layerSpec.mimeType)
	if (registered) {
		if (!context) {
			throw new Error(
				`Layer "${layerKey}" has a registered renderer, but this render call supplies no artifact ` +
					'context for it. Render the layer through the artifact that declares it.',
			)
		}
		const bindings = resolveLayerBindings(layers, layerSpec)
		const template = await buildRendererLayer(layerKey, layerSpec, bindings, options?.resolver, site)
		const formatter = context.formatter ?? options?.formatter
		const progressive = context.progressive ?? options?.progressive
		return (await registered.render({
			...context.subject,
			template,
			ctx: formatter || progressive
				? { formatter, progressive }
				: undefined,
		})) as string | Uint8Array
	}

	// A React layer names a module rather than carrying content, so there is
	// nothing here to return: it renders through a renderer registered for it.
	if (isReactLayerMimeType(layerSpec.mimeType)) {
		throw new UnregisteredLayerRendererError(layerKey, layerSpec.mimeType)
	}

	return readLayerContent(layerKey, layerSpec, options?.resolver, site)
}

/**
 * A text or binary layer's payload: an inline layer's text, or the bytes a
 * resolver reads for a file layer, checked against the layer's checksum and
 * decoded for text-based types.
 *
 * @throws {UnboundResolverError} when a file layer has no resolver to read it.
 * @throws {LayerChecksumError} when the bytes do not match the layer's checksum.
 */
/** A PDF layer file or its font that the resolver could not read while the form loaded. */
export class LayerReadError extends Error {
	readonly layerKey: string
	readonly path: string

	constructor(layerKey: string, path: string, cause: unknown) {
		super(`Layer "${layerKey}" could not be read from "${path}": ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
		this.name = 'LayerReadError'
		this.layerKey = layerKey
		this.path = path
	}
}

async function readLayerContent(
	layerKey: string,
	layerSpec: Layer,
	resolver: Resolver | undefined,
	site: ResolverBindingSite,
): Promise<string | Uint8Array> {
	if (layerSpec.kind === 'inline') return layerSpec.text
	if (layerSpec.kind === 'file') {
		if (!resolver) {
			throw new UnboundResolverError(layerKey, layerSpec.path, site)
		}
		const bytes = await resolver.read(layerSpec.path)
		await verifyLayerChecksum(bytes, layerSpec.checksum, layerKey, layerSpec.path, 'layer')
		const mimeType = layerSpec.mimeType.toLowerCase()
		return mimeType.startsWith('text/') || mimeType === 'application/json' ? new TextDecoder().decode(bytes) : bytes
	}
	throw new Error(`Unknown layer kind: ${(layerSpec as { kind: string }).kind}`)
}

/**
 * Refuses the `require` render option where it cannot apply. Only a filled
 * form's `render()` checks completeness; elsewhere the option would be
 * ignored, so a caller relying on it is told.
 *
 * @throws {TypeError} when `options.require` is set.
 */
export function refuseRequire(options: unknown, subject: string): void {
	const value = options !== null && typeof options === 'object' ? (options as { require?: unknown }).require : undefined
	if (value === undefined) return
	throw new TypeError(`${subject} cannot render with require: ${JSON.stringify(value)}; only a filled form's render() checks completeness.`)
}

/**
 * Resolves the layer key and renders it, for an artifact rendering its own layer.
 *
 * Not part of the package's public surface: it exists because a `Document`
 * resolves its layer through these primitives while carrying a resolver bound
 * at construction, so a missing one has to name the constructor rather than
 * these options. Forms and checklists reach `buildRendererLayer` directly and
 * name the site there.
 */
export async function resolveAndRenderArtifactLayer(
	layers: Record<string, Layer> | undefined,
	targetLayer: string | undefined,
	defaultLayer: string | undefined,
	options?: LayerRenderOptions,
	context?: LayerRenderContext,
): Promise<string | Uint8Array> {
	refuseRequire(options, 'A document')
	const key = resolveLayerKey(layers, targetLayer, defaultLayer, options)
	return renderLayerAt(layers, key, 'artifact', options, context)
}


// ============================================================================
// Renderer selection and template assembly
// ============================================================================

/**
 * Chooses the renderer for one layer.
 *
 * An explicit `renderer` override wins, then a renderer registered for the
 * layer's MIME type, then the built-in engines. A React layer has no built-in
 * engine — core would have to depend on React — so reaching the fallback with
 * one is an error naming the layer and how to register a renderer for it.
 *
 * @throws {UnregisteredLayerRendererError} when a React layer has no renderer.
 */
export function selectLayerRenderer<Output>(
	layerKey: string,
	layerSpec: Layer,
	override: AsterdocRenderer<RendererLayer, Output> | undefined,
	registry: RendererRegistry | undefined,
): AsterdocRenderer<RendererLayer, Output> {
	if (override) return override
	const registered = findRegisteredRenderer(registry, layerSpec.mimeType)
	if (registered) return registered as AsterdocRenderer<RendererLayer, Output>
	if (isReactLayerMimeType(layerSpec.mimeType)) {
		throw new UnregisteredLayerRendererError(layerKey, layerSpec.mimeType)
	}
	// The built-in engines render `string | Uint8Array`; the call site's Output
	// is whatever the caller asked the renderer for. One cast, here.
	return createLayerRenderer() as AsterdocRenderer<RendererLayer, Output>
}

export function refuseRenderOptions(options: object, allowed: readonly string[], subject: string): void {
	const unknown = Object.entries(options).filter(([key, value]) => value !== undefined && !allowed.includes(key)).map(([key]) => key)
	if (unknown.length === 0) return
	throw new TypeError(
		`${subject} has no render option ${unknown.map((key) => JSON.stringify(key)).join(', ')}. The options are ${allowed.join(', ')}. A PDF layer fills from the bindings the artifact declares.`,
	)
}

/**
 * Builds the `RendererLayer` a renderer receives for one layer.
 *
 * Text and binary layers carry their payload: an inline layer's text, or the
 * bytes a resolver reads for a file layer. A file layer that declares a font
 * carries it too, read through the same resolver, so a missing font, or one
 * that does not match its checksum, fails the way the layer file does. Each
 * declared checksum is checked against the bytes the resolver returns. A
 * React layer carries none. Its path
 * is a pointer to a composition module, which the renderer binds; core neither
 * reads nor executes it, so no resolver is needed and none is asked for.
 *
 * @param site - Where the resolver was meant to come from, so a missing one
 * names the right remedy. An artifact instance passes `artifact`; the free
 * primitives above pass `layers`.
 *
 * @throws {InlineReactLayerError} when a React MIME type is declared inline.
 * @throws {UnboundResolverError} when a file layer has no resolver to read it.
 * @throws {LayerChecksumError} when the layer's file or font does not match its checksum.
 */
export async function buildRendererLayer(
	layerKey: string,
	layerSpec: Layer,
	bindings: Bindings | undefined,
	resolver: Resolver | undefined,
	site: ResolverBindingSite,
): Promise<RendererLayer> {
	if (isReactLayerMimeType(layerSpec.mimeType)) {
		if (layerSpec.kind !== 'file') throw new InlineReactLayerError(layerKey)
		return {
			type: 'react',
			mimeType: layerSpec.mimeType,
			key: layerKey,
			path: layerSpec.path,
			...(bindings && { bindings }),
			...(layerSpec.format && { format: layerSpec.format }),
		}
	}

	const content = await readLayerContent(layerKey, layerSpec, resolver, site)

	const declared = layerSpec.kind === 'file' ? layerSpec.font : undefined
	const font = typeof declared === 'object' && resolver
		? await readLayerFont(layerKey, declared, resolver)
		: undefined

	return {
		type: 'text',
		content,
		mimeType: layerSpec.mimeType,
		key: layerKey,
		...(layerSpec.kind === 'file' && { path: layerSpec.path }),
		...(bindings && { bindings }),
		...(font && { font }),
		...(typeof declared === 'string' && { standardFont: declared }),
		...(layerSpec.format && { format: layerSpec.format }),
	}
}

async function readLayerFont(
	layerKey: string,
	font: { path: string; checksum?: string },
	resolver: Resolver,
): Promise<{ content: Uint8Array; path: string }> {
	const content = await resolver.read(font.path).catch((error: unknown) => {
		throw new LayerReadError(layerKey, font.path, error)
	})
	await verifyLayerChecksum(content, font.checksum, layerKey, font.path, 'font')
	return { content, path: font.path }
}
