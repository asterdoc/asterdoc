import { joinedBindingTemplate, PdfBindingSyntaxError } from '@asterdoc/render'
import type { SchemaVersion } from '@asterdoc/schemas'
import { UnconvertibleValueError } from './errors'

/** A parsed artifact as a plain JSON object. */
export type ArtifactObject = Record<string, unknown>

/**
 * Converts an artifact from one schema version to the next.
 *
 * `apply` receives a private copy it may change and returns the converted
 * artifact. When it meets a value it cannot convert safely it throws
 * `UnconvertibleValueError` naming the value, and the migration changes nothing.
 */
export interface MigrationStep {
	readonly from: SchemaVersion
	readonly to: SchemaVersion
	/** What the step changes, in one sentence. */
	readonly summary: string
	apply(artifact: ArtifactObject): ArtifactObject
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MAX_TEMPLATE_LENGTH = 2000

function joinedBinding(binding: unknown, path: readonly string[]): unknown {
	const joined = typeof binding === 'string' ? binding : isRecord(binding) && typeof binding.path === 'string' ? binding.path : undefined
	if (joined === undefined || !joined.includes(',')) return binding
	if (isRecord(binding) && binding.part !== undefined) {
		throw new UnconvertibleValueError(path, binding, 'a joined binding prints whole values, so it takes no part; bind each part to its own field.')
	}
	let template: string
	try {
		template = joinedBindingTemplate(joined)
	} catch (error) {
		if (!(error instanceof PdfBindingSyntaxError)) throw error
		throw new UnconvertibleValueError(path, binding, error.message)
	}
	if (template.length > MAX_TEMPLATE_LENGTH) {
		throw new UnconvertibleValueError(path, binding, `the template that prints the same text is longer than ${MAX_TEMPLATE_LENGTH} characters; write the binding as a template.`)
	}
	return isRecord(binding) && binding.format !== undefined ? { template, format: binding.format } : { template }
}

function joinedBindingsToTemplates(artifact: ArtifactObject): ArtifactObject {
	const { layers } = artifact
	if (!isRecord(layers)) return artifact
	for (const [key, layer] of Object.entries(layers)) {
		if (!isRecord(layer) || !isRecord(layer.bindings)) continue
		for (const [field, binding] of Object.entries(layer.bindings)) {
			layer.bindings[field] = joinedBinding(binding, ['layers', key, 'bindings', field])
		}
	}
	return artifact
}

/**
 * Every migration step, in version order. Each step leads from one published
 * version to the next, so a chain exists from every version to the current one.
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = [
	{
		from: '2026-10-28',
		to: '2026-11-06',
		summary: 'Adds the optional format.date setting to PDF layers; an artifact needs no change.',
		apply: (artifact) => artifact,
	},
	{
		from: '2026-11-06',
		to: '2026-11-10',
		summary: 'Adds the optional value-formatting settings; an artifact needs no change.',
		apply: (artifact) => artifact,
	},
	{
		from: '2026-11-10',
		to: '2026-11-12',
		summary: 'Adds template bindings to PDF layers and removes comma-joined bindings; each joined binding becomes the template that prints the same text.',
		apply: joinedBindingsToTemplates,
	},
]
