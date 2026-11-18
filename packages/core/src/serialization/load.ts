import type { Form, Document, Bundle, Checklist } from '@asterdoc/types'
import { parse } from './serialization'
import { LoadError } from './load-error'
import { findSchemaVersionError } from './schema-version'
import type { SchemaReadOptions } from '@/migration/upgrade'
import { form, type FormInstance } from '@/artifacts/form'
import { document, type DocumentInstance } from '@/artifacts/document'
import { bundle, type BundleInstance } from '@/artifacts/bundle'
import { checklist, type ChecklistInstance } from '@/artifacts/checklist'
import type { ArtifactInstanceOptions } from '@/artifacts/shared/render-layer'

// ============================================================================
// Type definitions
// ============================================================================

/**
 * Union of all artifact instance types with proper discriminators
 */
export type AnyArtifactInstance =
  | FormInstance<Form>
  | DocumentInstance<Document>
  | BundleInstance<Bundle>
  | ChecklistInstance<Checklist>

/**
 * A resolver was supplied for a bundle.
 *
 * A bundle binds none: its parts are artifact instances that each carry the
 * resolver they were constructed with, so one handed to the bundle would have
 * nothing to bind to and would be silently dropped. The typed `<'bundle'>`
 * overloads of the loaders take no resolver; this catches the untyped
 * path, where the kind is only known once the object is parsed.
 */
export class BundleResolverError extends LoadError {
  constructor() {
    super(
      'A bundle takes no resolver: its parts are artifact instances that each carry the ' +
        'resolver they were constructed with. Bind the resolver on each part instead.'
    )
    this.name = 'BundleResolverError'
  }
}

export { LoadError }

const ARTIFACT_KINDS = new Set(['form', 'document', 'bundle', 'checklist'])

// ============================================================================
// Type guards for runtime discrimination
// ============================================================================

/**
 * Type guard to check if an instance is a FormInstance
 */
export function isFormInstance(instance: AnyArtifactInstance): instance is FormInstance<Form> {
  return instance.kind === 'form'
}

/**
 * Type guard to check if an instance is a DocumentInstance
 */
export function isDocumentInstance(instance: AnyArtifactInstance): instance is DocumentInstance<Document> {
  return instance.kind === 'document'
}

/**
 * Type guard to check if an instance is a BundleInstance
 */
export function isBundleInstance(instance: AnyArtifactInstance): instance is BundleInstance<Bundle> {
  return instance.kind === 'bundle'
}

/**
 * Type guard to check if an instance is a ChecklistInstance
 */
export function isChecklistInstance(instance: AnyArtifactInstance): instance is ChecklistInstance<Checklist> {
  return instance.kind === 'checklist'
}

// ============================================================================
// Load Functions
// ============================================================================

/**
 * Load an artifact from a string (YAML or JSON) or a parsed object, returning
 * the instance its `kind` names. A form is loaded with `form.load()`: every
 * PDF layer is read through the resolver into the profile its validation
 * checks data against, so loading is asynchronous for every kind.
 *
 * A string must carry `$schema`; an object without it is accepted as one
 * built in memory with the SDK. One that names an earlier schema version is
 * upgraded in memory to the current one, and the instance records it in
 * `migratedFrom`; the input is never rewritten. Pass `strictSchema: true` to
 * refuse an earlier version instead.
 *
 * @param input - YAML or JSON text, or a parsed artifact object
 * @param options - The resolver for file-backed layers (not for a bundle), and `strictSchema`
 * @throws LoadError if parsing fails, the artifact kind is unknown, or a form's PDF layer cannot be read
 * @throws SchemaVersionError if `$schema` is missing from text, names a version newer than this SDK
 *   knows, names no published version, cannot be upgraded without loss, or, with
 *   `strictSchema`, names an earlier version
 *
 * @example
 * ```typescript
 * import { load } from '@asterdoc/core'
 *
 * const contract = await load<'form'>(fileContents, { resolver })
 * const artifact = await load(fileContents)
 * if (artifact.kind === 'checklist') artifact.items
 * ```
 */
export function load<_K extends 'form'>(input: unknown, options?: ArtifactInstanceOptions): Promise<FormInstance<Form>>;
export function load<_K extends 'document'>(input: unknown, options?: ArtifactInstanceOptions): Promise<DocumentInstance<Document>>;
export function load<_K extends 'bundle'>(input: unknown, options?: SchemaReadOptions): Promise<BundleInstance<Bundle>>;
export function load<_K extends 'checklist'>(input: unknown, options?: ArtifactInstanceOptions): Promise<ChecklistInstance<Checklist>>;
export function load(input: unknown, options?: ArtifactInstanceOptions): Promise<AnyArtifactInstance>;
export async function load(input: unknown, options?: ArtifactInstanceOptions): Promise<AnyArtifactInstance> {
  if (typeof input !== 'string') return loadArtifactObject(input, options, { required: false })
  let parsed: unknown
  try {
    parsed = parse(input)
  } catch (err) {
    throw new LoadError(
      'Failed to parse content as YAML or JSON',
      err instanceof Error ? err : new Error(String(err))
    )
  }
  return loadArtifactObject(parsed, options, { required: true })
}

/**
 * Load a parsed artifact. `required` applies the rule for artifact files:
 * `$schema` must be present. Each kind's loader then applies the schema
 * version rule: an earlier version is upgraded in memory unless
 * `strictSchema` refuses it.
 */
async function loadArtifactObject(
  obj: unknown,
  options: ArtifactInstanceOptions | undefined,
  version: { required: boolean },
): Promise<AnyArtifactInstance> {
  if (!obj || typeof obj !== 'object') {
    throw new LoadError('Invalid artifact: expected an object')
  }

  if (!('kind' in obj) || typeof obj.kind !== 'string') {
    throw new LoadError('Invalid artifact: missing or invalid "kind" field')
  }

  const kind = obj.kind

  // Outside the try, so it surfaces as itself rather than as a LoadError about
  // a bundle that is in fact perfectly loadable.
  if (kind === 'bundle' && options?.resolver) throw new BundleResolverError()

  if (!ARTIFACT_KINDS.has(kind)) throw new LoadError(`Unknown artifact kind: "${kind}"`)

  // Outside the try as well: a version error is its own answer, not a failed load.
  const missing = version.required ? findSchemaVersionError(obj, { required: true }) : undefined
  if (missing?.code === 'missing-version') throw missing

  try {
    switch (kind) {
      case 'form':
        return await form.load(obj as never, options) as FormInstance<Form>

      case 'document':
        return document.from(obj, options) as DocumentInstance<Document>

      // A bundle binds no resolver: its parts are artifact instances that
      // each carry their own. Guarded above.
      case 'bundle':
        return bundle.from(obj, { strictSchema: options?.strictSchema }) as BundleInstance<Bundle>

      case 'checklist':
        return checklist.from(obj, options) as ChecklistInstance<Checklist>

      default:
        throw new LoadError(`Unknown artifact kind: "${kind}"`)
    }
  } catch (err) {
    if (err instanceof LoadError) {
      throw err
    }
    throw new LoadError(
      `Failed to load ${kind} artifact: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined
    )
  }
}

/**
 * {@link load}, with the failure as a result instead of a thrown error.
 */
export function safeLoad<_K extends 'form'>(input: unknown, options?: ArtifactInstanceOptions): Promise<{ success: true; data: FormInstance<Form> } | { success: false; error: LoadError }>;
export function safeLoad<_K extends 'document'>(input: unknown, options?: ArtifactInstanceOptions): Promise<{ success: true; data: DocumentInstance<Document> } | { success: false; error: LoadError }>;
export function safeLoad<_K extends 'bundle'>(input: unknown, options?: SchemaReadOptions): Promise<{ success: true; data: BundleInstance<Bundle> } | { success: false; error: LoadError }>;
export function safeLoad<_K extends 'checklist'>(input: unknown, options?: ArtifactInstanceOptions): Promise<{ success: true; data: ChecklistInstance<Checklist> } | { success: false; error: LoadError }>;
export function safeLoad(input: unknown, options?: ArtifactInstanceOptions): Promise<{ success: true; data: AnyArtifactInstance } | { success: false; error: LoadError }>;
export async function safeLoad(input: unknown, options?: ArtifactInstanceOptions): Promise<{ success: true; data: AnyArtifactInstance } | { success: false; error: LoadError }> {
  try {
    return { success: true, data: await load(input, options) }
  } catch (err) {
    const error = err instanceof LoadError ? err : new LoadError(String(err), err instanceof Error ? err : undefined)
    return { success: false, error }
  }
}
