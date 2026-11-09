import type { BindingValue, Bindings, Form, FormField, LayerFormat } from '@asterdoc/types'
import { pathSegments } from './path'

/** The part of a layer that decides which bindings it fills with. */
export interface LayerBindingsSpec {
  mimeType?: string
  bindings?: Bindings
  bindingsFrom?: string
}

// @asterdoc/render does not depend on @asterdoc/schemas, so the PDF check is stated here.
function isPdfLayer(layer: LayerBindingsSpec): boolean {
  return layer.mimeType?.toLowerCase() === 'application/pdf'
}

/**
 * The bindings a layer fills with: its own, or else those of the sibling layer
 * its `bindingsFrom` names. The reference is one hop: the sibling's own
 * `bindings`, never its `bindingsFrom`. Each binding carries over with its own
 * format; the layer's `format` is always its own.
 *
 * Only PDF layers have bindings, which map AcroForm field names to Asterdoc
 * paths; any other layer, or a source that is not a PDF layer, gives none.
 *
 * Throws when `bindingsFrom` names a layer that does not exist.
 */
export function resolveLayerBindings(
  layers: Record<string, LayerBindingsSpec>,
  layer: LayerBindingsSpec,
): Bindings | undefined {
  if (!isPdfLayer(layer)) return undefined
  if (layer.bindings || !layer.bindingsFrom) return layer.bindings
  const source = layers[layer.bindingsFrom]
  if (!source) {
    throw new Error(`bindingsFrom "${layer.bindingsFrom}" references unknown layer. Available: ${Object.keys(layers).join(', ')}`)
  }
  return isPdfLayer(source) ? source.bindings : undefined
}

/** One path a PDF binding value reads. */
export interface PdfBindingPart {
  /** The path as the binding writes it, trimmed: `fields.name`, `ssn`. */
  source: string
  /** Where the path sits in fill data, historically without the `fields` root. */
  path: string
  /** The text after `:`, trimmed: the option a checkbox tests, or the one-based part a split binding fills. */
  qualifier?: string
}

/** A PDF binding value whose syntax no fill, extraction, or check can read. */
export class PdfBindingSyntaxError extends Error {
  readonly binding: string

  constructor(binding: string, problem: string) {
    super(`Binding ${JSON.stringify(binding)} ${problem}.`)
    this.name = 'PdfBindingSyntaxError'
    this.binding = binding
  }
}

/** One PDF binding, read from either of the shapes a binding value takes. */
export interface ParsedPdfBinding {
  /** The binding's path text: the string binding, or a binding object's `path`. */
  path: string
  /** The paths the binding reads. */
  parts: PdfBindingPart[]
  /** The format a binding object declares, merged over its layer's format. */
  format?: LayerFormat
}

/** One binding of a layer, with the PDF field it fills. */
export interface ParsedLayerBinding extends ParsedPdfBinding {
  /** Fully qualified name of the AcroForm field the binding fills. */
  field: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a PDF binding value, a path string or a binding object, into the
 * paths it reads and the format it declares. Fill, extraction, the fit check,
 * and validation all read bindings through this one parser.
 *
 * - `name` or `fields.name` reads one path.
 * - `status:married` tests an option; `ssn:2` fills the second hyphen-separated
 *   part. Space around the `:` is ignored.
 * - `city, state, zip` joins several whole values with `, `. A part of a joined
 *   binding takes no qualifier.
 * - `{ path, format }` reads `path` as a string binding does and prints with
 *   `format`.
 *
 * @throws {PdfBindingSyntaxError} for a value of neither shape, an empty part
 * or qualifier, or a qualifier inside a joined binding.
 */
export function parseBinding(value: BindingValue): ParsedPdfBinding {
  if (typeof value === 'string') return { path: value, parts: parsePath(value) }
  if (!isRecord(value) || typeof value.path !== 'string') {
    throw new PdfBindingSyntaxError(JSON.stringify(value) ?? String(value), 'is neither a path string nor a binding object with a string path')
  }
  if (value.format !== undefined && !isRecord(value.format)) {
    throw new PdfBindingSyntaxError(value.path, 'has a format that is not an object')
  }
  return { path: value.path, parts: parsePath(value.path), ...(value.format !== undefined && { format: value.format }) }
}

function parsePath(binding: string): PdfBindingPart[] {
  const parts = binding.split(',').map((text): PdfBindingPart => {
    const separator = text.indexOf(':')
    const source = (separator === -1 ? text : text.slice(0, separator)).trim()
    if (!source) throw new PdfBindingSyntaxError(binding, 'has an empty path')
    if (separator === -1) return { source, path: bindingDataPath(source) }
    const qualifier = text.slice(separator + 1).trim()
    if (!qualifier) throw new PdfBindingSyntaxError(binding, `has an empty qualifier after "${source}:"`)
    return { source, path: bindingDataPath(source), qualifier }
  })
  if (parts.length > 1 && parts.some((part) => part.qualifier !== undefined)) {
    throw new PdfBindingSyntaxError(binding, 'qualifies a part of a joined binding; a joined binding reads whole values')
  }
  return parts
}

/** Parse every binding of a layer. @throws {PdfBindingSyntaxError} as {@link parseBinding} does. */
export function parseBindings(bindings: Bindings): ParsedLayerBinding[] {
  return Object.entries(bindings).map(([field, binding]) => ({ field, ...parseBinding(binding) }))
}

/** The field definition a data path names, through fieldsets and list items. */
export function fieldDefinition(form: Form | undefined, path: string): FormField | undefined {
  const [root, ...segments] = pathSegments(path)
  let field = root ? form?.fields?.[root] : undefined
  for (const segment of segments) {
    if (field?.type === 'list' && /^\d+$/.test(segment)) field = field.item
    else if (field?.type === 'fieldset') field = field.fields[segment]
    else return undefined
  }
  return field
}

/**
 * Whether a binding part tests an option and so fills a checkbox: a qualifier
 * on a boolean or choice field, or one that names no split part.
 */
export function isOptionTest(form: Form | undefined, part: PdfBindingPart): boolean {
  if (part.qualifier === undefined) return false
  const type = fieldDefinition(form, part.path)?.type
  return type === 'boolean' || type === 'enum' || type === 'multiselect' || splitPartIndex(part.qualifier) === undefined
}

/**
 * Why a binding's format cannot apply, or undefined when it can. An option test
 * writes a checkbox state, never a printed value, and a split part prints a
 * piece of the raw value, so neither takes a format.
 */
export function bindingFormatProblem(form: Form | undefined, binding: ParsedPdfBinding): string | undefined {
  if (binding.format === undefined) return undefined
  const qualified = binding.parts.find((part) => part.qualifier !== undefined)
  if (!qualified) return undefined
  const source = `${qualified.source}:${qualified.qualifier}`
  return isOptionTest(form, qualified)
    ? `sets a format on the option test "${source}", which fills a checkbox and prints no value`
    : `sets a format on the split part "${source}", which prints a piece of the raw value`
}

/**
 * Refuse any binding whose format cannot apply.
 * @throws {PdfBindingSyntaxError} naming the first such binding.
 */
export function assertBindingFormats(form: Form | undefined, bindings: readonly ParsedPdfBinding[]): void {
  for (const binding of bindings) {
    const problem = bindingFormatProblem(form, binding)
    if (problem) throw new PdfBindingSyntaxError(binding.path, problem)
  }
}

/**
 * The zero-based part a split qualifier names: `2` is `1`. Undefined when the
 * qualifier is not a positive whole number, so it names an option instead.
 */
export function splitPartIndex(qualifier: string): number | undefined {
  return /^[1-9]\d*$/.test(qualifier) ? Number(qualifier) - 1 : undefined
}

/** A PDF binding key that names no form field of the template. */
export class PdfBindingKeyError extends Error {
  /** The binding keys the template has no field for. */
  readonly keys: string[]

  constructor(keys: string[], templateFields: string[]) {
    super(
      `PDF bindings name form fields the template does not have: ${keys.map((key) => JSON.stringify(key)).join(', ')}. ` +
        (templateFields.length > 0 ? `Template fields: ${templateFields.join(', ')}` : 'The template has no form fields'),
    )
    this.name = 'PdfBindingKeyError'
    this.keys = keys
  }
}

/** The normalized artifact path used to validate and extract a PDF binding. */
export function bindingDataPath(path: string): string {
  const trimmed = path.trim()
  return trimmed.startsWith('fields.') ? trimmed.slice('fields.'.length) : trimmed
}

/** The path used to read a binding from canonical render data. */
export function renderDataPath(data: Record<string, unknown>, path: string): string {
  const trimmed = path.trim()
  const hasFieldsRoot = data.fields !== null && typeof data.fields === 'object' && !Array.isArray(data.fields)
  if (!hasFieldsRoot) return bindingDataPath(trimmed)
  if (trimmed.startsWith('fields.')) return trimmed
  const root = trimmed.split('.', 1)[0]
  return root === 'parties' || root === 'annexes' || root === 'defs' || root === '_signers' || root === '_captures'
    ? trimmed
    : `fields.${trimmed}`
}
