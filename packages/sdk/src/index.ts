/**
 * @asterdoc/sdk
 *
 * Umbrella package for the Asterdoc framework. Re-exports everything from
 * @asterdoc/core, @asterdoc/format, and @asterdoc/sessions, plus render's
 * createLayerRenderer, the PDF placement helpers, and hostedSealAdapter.
 */

// Re-export from @asterdoc/core
export * from '@asterdoc/core'

// Re-export the MIME-selected renderer factory. Format-specific APIs live at
// @asterdoc/render/text, @asterdoc/render/pdf, and @asterdoc/render/docx.
export { createLayerRenderer } from '@asterdoc/render'
export type { CreateLayerRendererOptions } from '@asterdoc/render'
export { HOSTED_CONVERT_PATH, HostedConversionError, hostedSealAdapter } from './hosted-seal-adapter'
export type { HostedSealAdapterOptions } from './hosted-seal-adapter'

// Placement: locate signature markers and anchor text in converted PDFs.
// Complements sealing with pure converters such as hostedSealAdapter.
export {
	FieldType,
	LocateError,
	containsEncoding,
	decodeAll,
	encode,
	extractFieldsFromPdf,
	locate,
	locator,
	pdfContainsEncoding,
	stripEncoding,
	UnknownMarkerError,
} from '@asterdoc/render/pdf'
export type { ExtractedField, LocateQuery, UnknownMarker } from '@asterdoc/render/pdf'

// Re-export the standalone presentation formatter for SDK consumers.
export * from '@asterdoc/format'

// Re-export from @asterdoc/sessions
export * from '@asterdoc/sessions'
