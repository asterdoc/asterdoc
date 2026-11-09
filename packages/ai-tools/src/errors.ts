import { ZodError } from 'zod'
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

export function errorFromUnknown(error: unknown, fallbackCode = 'execution_error'): ToolError {
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
