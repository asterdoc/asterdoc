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
import { readSchemaAddress, SCHEMA_VERSION } from '@asterdoc/schemas'
import { assertCurrentSchemaVersion } from '@/serialization/schema-version'
import { CORE_VERSION } from '@/version'
import { createParser, formatZodError } from './zod-parser'

/**
 * The hint an unknown key gets in an artifact that declares the current
 * schema version. Additive options join the current version in place, so such
 * a key may be one a newer release added.
 */
export const NEWER_RELEASE_HINT = `This key may come from a newer Asterdoc release than @asterdoc/core ${CORE_VERSION}. Update the SDK.`

function declaresCurrentVersion(input: unknown): boolean {
	if (typeof input !== 'object' || input === null) return false
	const address = (input as { $schema?: unknown }).$schema
	if (typeof address !== 'string') return false
	const read = readSchemaAddress(address)
	return read.kind === 'known' && read.version === SCHEMA_VERSION
}

/**
 * Factory for a whole-artifact parser. Every artifact entry point parses
 * through one of these, so each holds the input to the current schema version
 * before the schema: an object may leave out `$schema`, as one built in memory
 * does, but one it declares must be current, on the root and on every inline
 * bundle part. Only `migrate` accepts another version. An unknown key in an
 * artifact that declares the current version carries {@link NEWER_RELEASE_HINT}.
 */
function createWholeArtifactParser<T>(schemaName: string, schema: ZodType<T>): (input: unknown) => T {
	return (input: unknown): T => {
		assertCurrentSchemaVersion(input, { required: false })
		const result = schema.safeParse(input)
		if (result.success) return result.data
		const message = formatZodError(result.error, schemaName)
		const unknownKey = result.error.issues[0]?.code === 'unrecognized_keys'
		throw new Error(unknownKey && declaresCurrentVersion(input) ? `${message}. ${NEWER_RELEASE_HINT}` : message)
	}
}

// ─────────────────────────────────────────────────────────────
// Artifact Parsers
// ─────────────────────────────────────────────────────────────

export const parseForm = createWholeArtifactParser<Form>('Form', FormSchema)

export const parseBundle = createWholeArtifactParser<Bundle>('Bundle', BundleSchema)

export const parseDocument = createWholeArtifactParser<Document>('Document', DocumentSchema)

export const parseChecklist = createWholeArtifactParser<Checklist>('Checklist', ChecklistSchema)

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
