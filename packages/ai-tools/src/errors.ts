import { ZodError } from 'zod'
import type { RenderProblemReport } from '@asterdoc/core'
import type { ToolError } from './contracts'

type Candidates = NonNullable<ToolError['candidates']>

export function toolError(code: string, message: string, path?: Array<string | number>, retryable = false, candidates?: Candidates): ToolError {
	return { code, message, ...(path ? { path } : {}), ...(retryable ? { retryable: true } : {}), ...(candidates ? { candidates } : {}) }
}

function candidatesOf(value: unknown): Candidates | undefined {
	if (!Array.isArray(value)) return undefined
	return value.flatMap((entry) =>
		entry && typeof entry === 'object' && typeof (entry as { code?: unknown }).code === 'string' && typeof (entry as { name?: unknown }).name === 'string'
			? [{ code: (entry as { code: string }).code, name: (entry as { name: string }).name }]
			: [],
	)
}

interface LayerFileError extends Error {
	readonly layerKey: string
	readonly path: string
}

function layerFileError(error: unknown, name: string): LayerFileError | undefined {
	for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) {
		if (current.name === name && typeof (current as Partial<LayerFileError>).layerKey === 'string') return current as LayerFileError
	}
	return undefined
}

function causeText(error: Error): string {
	return error.cause instanceof Error ? error.cause.message : error.message
}

function layerToolError(error: unknown): ToolError | undefined {
	const unbound = layerFileError(error, 'UnboundResolverError')
	if (unbound) {
		return toolError(
			'layer_files_unreachable',
			`This artifact keeps its layer "${unbound.layerKey}" in the file "${unbound.path}", and that file cannot be read: the artifact came without base_url. ` +
				"Give base_url, the URL of the folder that holds the artifact's files, or name the artifact by its registry name or its URL.",
		)
	}
	const unreadable = layerFileError(error, 'LayerReadError')
	if (unreadable) {
		return toolError('layer_file_unreadable', `The file "${unreadable.path}" of this artifact's layer "${unreadable.layerKey}" could not be read: ${causeText(unreadable)}. Check base_url, or try again.`, undefined, true)
	}
	const mismatch = layerFileError(error, 'LayerChecksumError')
	if (mismatch) {
		return toolError('layer_checksum_mismatch', `The file "${mismatch.path}" of this artifact's layer "${mismatch.layerKey}" is not the file the artifact declares: its checksum does not match. The artifact cannot be used with these files.`)
	}
	return undefined
}

export function errorFromUnknown(error: unknown, fallbackCode = 'execution_error'): ToolError {
	const layer = layerToolError(error)
	if (layer) return layer
	if (error instanceof ZodError) {
		return toolError('invalid_input', error.message)
	}
	if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
		const value = error as { code?: unknown; message?: unknown; path?: unknown; retryable?: unknown }
		if (typeof value.code === 'string' && typeof value.message === 'string') {
			return toolError(
				value.code,
				value.message,
				Array.isArray(value.path) ? value.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number') : undefined,
				value.retryable === true,
			)
		}
	}
	return toolError(fallbackCode, error instanceof Error ? error.message : 'Unknown tool error')
}
export function renderProblemErrors(reports: readonly RenderProblemReport[]): ToolError[] {
	return reports.map(({ path, keyword, code, message, layer, pdf_field }) => ({
		code,
		message,
		path: path.split('.'),
		keyword,
		layer,
		...(pdf_field !== undefined && { pdf_field }),
	}))
}

export function validationErrors(error: unknown): ToolError[] {
	const errors = Array.isArray(error)
		? error
		: error && typeof error === 'object' && 'errors' in error ? (error as { errors?: unknown }).errors : undefined
	if (Array.isArray(errors)) {
		return errors.map((entry) => {
			if (entry && typeof entry === 'object') {
				const value = entry as { field?: unknown; message?: unknown; path?: unknown; code?: unknown; candidates?: unknown }
				const path = Array.isArray(value.path)
					? value.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
					: typeof value.field === 'string' ? value.field.split('.') : undefined
				return toolError(
					typeof value.code === 'string' ? value.code : 'validation_error',
					typeof value.message === 'string' ? value.message : String(entry),
					path,
					false,
					candidatesOf(value.candidates),
				)
			}
			return toolError('validation_error', String(entry))
		})
	}
	return [errorFromUnknown(error, 'validation_error')]
}
