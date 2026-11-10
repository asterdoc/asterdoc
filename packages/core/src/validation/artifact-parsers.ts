/**
 * Artifact Parsers
 *
 * Ready-to-use parse functions for all Asterdoc artifacts and blocks.
 * These use Zod schemas directly for strict validation.
 */

import type {
	Form,
	FormField,
	FormAnnex,
	FormParty,
	Layer,
	Bundle,
	BundleContentItem,
	Document,
	Checklist,
	ChecklistItem,
} from '@asterdoc/types'
import {
	FormSchema,
	DocumentSchema,
	BundleSchema,
	ChecklistSchema,
	FormFieldSchema,
	FormAnnexSchema,
	FormPartySchema,
	LayerSchema,
	BundleContentItemSchema,
	ChecklistItemSchema,
} from '@asterdoc/schemas'
import type { ZodType } from 'zod'
import { originOf, type DefinitionOrigin } from '@/artifacts/shared/definition-origin'
import { upgradeArtifact, type SchemaReadOptions } from '@/migration/upgrade'
import { createParser, formatZodError } from './zod-parser'

/** A definition read at the current schema version, and where it came from when reading upgraded it. */
export interface ReadDefinition<T> {
	readonly definition: T
	readonly origin: DefinitionOrigin<T> | undefined
}

/**
 * Factory for a whole-artifact reader. Every artifact entry point reads
 * through one of these, so each applies the same schema version rule before
 * the schema: an object may leave out `$schema`, as one built in memory does;
 * one that declares an earlier version, on the root or on an inline bundle
 * part, is upgraded in memory unless `strictSchema` refuses it.
 */
function createWholeArtifactReader<T>(
	schemaName: string,
	schema: ZodType<T>,
): (input: unknown, options?: SchemaReadOptions) => ReadDefinition<T> {
	return (input, options) => {
		const { artifact, migratedFrom } = upgradeArtifact(input, { strictSchema: options?.strictSchema })
		const result = schema.safeParse(artifact)
		if (result.success) return { definition: result.data, origin: originOf<T>(input, migratedFrom) }
		throw new Error(formatZodError(result.error, schemaName))
	}
}

function parserOf<T>(read: (input: unknown, options?: SchemaReadOptions) => ReadDefinition<T>) {
	return (input: unknown, options?: SchemaReadOptions): T => read(input, options).definition
}

export const readForm = createWholeArtifactReader<Form>('Form', FormSchema)
export const readBundle = createWholeArtifactReader<Bundle>('Bundle', BundleSchema)
export const readDocument = createWholeArtifactReader<Document>('Document', DocumentSchema)
export const readChecklist = createWholeArtifactReader<Checklist>('Checklist', ChecklistSchema)

// ─────────────────────────────────────────────────────────────
// Artifact Parsers
// ─────────────────────────────────────────────────────────────

export const parseForm = parserOf(readForm)

export const parseBundle = parserOf(readBundle)

export const parseDocument = parserOf(readDocument)

export const parseChecklist = parserOf(readChecklist)

// ─────────────────────────────────────────────────────────────
// Block Parsers (Form components)
// ─────────────────────────────────────────────────────────────

export const parseFormField = createParser<FormField>('FormField', FormFieldSchema)

export const parseFormAnnex = createParser<FormAnnex>('FormAnnex', FormAnnexSchema)

export const parseFormParty = createParser<FormParty>('FormParty', FormPartySchema)

export const parseLayer = createParser<Layer>('Layer', LayerSchema)

// ─────────────────────────────────────────────────────────────
// Collection Item Parsers
// ─────────────────────────────────────────────────────────────

export const parseBundleContentItem = createParser<BundleContentItem>(
	'BundleContentItem',
	BundleContentItemSchema,
)

export const parseChecklistItem = createParser<ChecklistItem>(
	'ChecklistItem',
	ChecklistItemSchema,
)
