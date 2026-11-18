import type { BindingValue, Bindings, Form, FormField, LayerFormat, StandardPdfFont, ValueFormat, ValuePart } from '@asterdoc/types'
import { pathSegments } from './path'
import { mergeFormats } from './presentation'
import { ALL_VALUE_PARTS, bindingDeclaration, isValuePart, partsOf, printProblem } from './parts/rules'
import { joinedTemplate, parseBindingTemplate, pathExpression, type BindingTemplate } from './template/binding'

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

/** One PDF binding, read from any of the shapes a binding value takes. */
export interface ParsedPdfBinding {
  /** The binding's text: the string binding, or a binding object's `path` or `template`. */
  path: string
  /** The paths the binding reads: the one a path binding names, or every one a template's placeholders read. */
  parts: PdfBindingPart[]
  /** The format a binding object declares, merged over its layer's format. */
  format?: ValueFormat
  /** The part of the value a binding object prints, such as a date's `year`. */
  part?: ValuePart
  /** The template a template binding prints. */
  template?: BindingTemplate
  /** The standard font a binding object declares for its field. */
  font?: StandardPdfFont
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
 * - `{ path, format, part }` reads `path` as a string binding does and prints
 *   with `format`, or prints only `part` of the value.
 * - `{ template, format }` prints a template: several values and the text
 *   between them, such as `{{fields.city}}, {{fields.state}} {{fields.zip}}`.
 *
 * @throws {PdfBindingSyntaxError} for a value of none of these shapes, an
 * empty path or qualifier, several paths joined with a comma, a `part` that is
 * not a string or sits on a template, or a template whose markers do not
 * pair or that holds an `{{#each}}` loop or a signing directive.
 */
export function parseBinding(value: BindingValue): ParsedPdfBinding {
  if (typeof value === 'string') return { path: value, parts: [parsePath(value)] }
  const described = () => JSON.stringify(value) ?? String(value)
  if (!isRecord(value)) throw new PdfBindingSyntaxError(described(), 'is neither a path string nor a binding object')
  const { path, template, format, part, font } = value as Record<string, unknown>
  if (path !== undefined && template !== undefined) {
    throw new PdfBindingSyntaxError(described(), 'holds both a path and a template; a binding object holds one of them')
  }
  const text = path ?? template
  if (typeof text !== 'string') {
    throw new PdfBindingSyntaxError(described(), 'is neither a path string nor a binding object with a string path or template')
  }
  if (format !== undefined && !isRecord(format)) throw new PdfBindingSyntaxError(text, 'has a format that is not an object')
  if (font !== undefined && font !== 'Helvetica' && font !== 'Courier') throw new PdfBindingSyntaxError(text, 'has a font that is neither "Helvetica" nor "Courier"')
  const chosen = font === undefined ? {} : { font: font as StandardPdfFont }
  if (template !== undefined) {
    if (part !== undefined) throw new PdfBindingSyntaxError(text, 'sets a part on a template; write it on a placeholder, such as {{fields.dob | part="year"}}')
    const parsed = parseBindingTemplate(text)
    if ('problem' in parsed) throw new PdfBindingSyntaxError(text, parsed.problem)
    return {
      path: text,
      parts: templateParts(parsed.template),
      ...(format !== undefined && { format: format as ValueFormat }),
      template: parsed.template,
      ...chosen,
    }
  }
  if (part !== undefined && typeof part !== 'string') throw new PdfBindingSyntaxError(text, 'has a part that is not a string')
  return {
    path: text,
    parts: [parsePath(text)],
    ...(format !== undefined && { format: format as ValueFormat }),
    ...(part !== undefined && { part: part as ValuePart }),
    ...chosen,
  }
}

const TEMPLATE_ROOTS = new Set(['fields', 'parties', 'annexes'])

function templatePart(segments: readonly string[]): PdfBindingPart {
  const source = TEMPLATE_ROOTS.has(segments[0]!) ? segments.join('.') : ['defs', ...segments].join('.')
  return { source, path: bindingDataPath(source) }
}

function templateParts(template: BindingTemplate): PdfBindingPart[] {
  const parts = new Map<string, PdfBindingPart>()
  for (const segments of template.references) {
    const part = templatePart(segments)
    if (!parts.has(part.source)) parts.set(part.source, part)
  }
  return [...parts.values()]
}

/** The binding path a placeholder of a binding template prints, or undefined for a computed value. */
export function templateSlotPart(segments: readonly string[] | undefined): PdfBindingPart | undefined {
  return segments ? templatePart(segments) : undefined
}

function templateSegments(source: string): string[] {
  const segments = pathSegments(renderDataPath({ fields: {} }, source))
  return segments[0] === 'defs' ? segments.slice(1) : segments
}

/**
 * The template that prints what a comma-joined binding of schema 2026-11-10
 * printed: each path's value, with `, ` between the values that are not empty.
 *
 * @throws {PdfBindingSyntaxError} when a joined path is empty or has a `:` qualifier.
 */
export function joinedBindingTemplate(binding: string): string {
  return joinedTemplate(binding.split(',').map((text) => {
    const source = text.trim()
    if (!source) throw new PdfBindingSyntaxError(binding, 'has an empty path')
    if (source.includes(':')) throw new PdfBindingSyntaxError(binding, 'qualifies a part of a joined binding; a joined binding reads whole values')
    return templateSegments(source)
  }))
}

function joinProblem(binding: string): string {
  const paths = binding.split(',').map((text) => text.trim())
  const template = paths.every((path) => path !== '' && !path.includes(':'))
    ? paths.map((path) => `{{${pathExpression(templateSegments(path))}}}`).join(', ')
    : '{{fields.city}}, {{fields.state}}'
  return `joins several paths with a comma, which a binding does not do; print several values in one field with a template, such as ${JSON.stringify({ template })}`
}

function parsePath(binding: string): PdfBindingPart {
  if (binding.includes(',')) throw new PdfBindingSyntaxError(binding, joinProblem(binding))
  const separator = binding.indexOf(':')
  const source = (separator === -1 ? binding : binding.slice(0, separator)).trim()
  if (!source) throw new PdfBindingSyntaxError(binding, 'has an empty path')
  if (separator === -1) return { source, path: bindingDataPath(source) }
  const qualifier = binding.slice(separator + 1).trim()
  if (!qualifier) throw new PdfBindingSyntaxError(binding, `has an empty qualifier after "${source}:"`)
  return { source, path: bindingDataPath(source), qualifier }
}

/** Parse every binding of a layer. @throws {PdfBindingSyntaxError} as {@link parseBinding} does. */
export function parseBindings(bindings: Bindings): ParsedLayerBinding[] {
  return Object.entries(bindings).map(([field, binding]) => ({ field, ...parseBinding(binding) }))
}

/** The standard font each binding object declares, by the AcroForm field it fills. */
export function bindingFonts(bindings: Bindings | undefined): Map<string, StandardPdfFont> {
  return new Map(parseBindings(bindings ?? {}).flatMap((binding) => binding.font ? [[binding.field, binding.font] as const] : []))
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

/** Whether a field, or any field inside it, prints through a mask. */
export function containsMask(field: FormField | undefined): boolean {
  if (!field) return false
  if (field.type === 'text') return field.mask !== undefined
  if (field.type === 'list') return containsMask(field.item)
  if (field.type === 'fieldset') return Object.values(field.fields).some(containsMask)
  return false
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
 * Why a binding's part cannot apply, or undefined when it can. A part reads
 * one whole value of a kind that has it, so it takes no `:` qualifier.
 */
export function bindingPartProblem(form: Form | undefined, binding: ParsedPdfBinding): string | undefined {
  const { part } = binding
  if (part === undefined) return undefined
  const [only] = binding.parts as [PdfBindingPart]
  if (only.qualifier !== undefined) {
    const source = `${only.source}:${only.qualifier}`
    return isOptionTest(form, only)
      ? `sets a part on the option test "${source}", which fills a checkbox and prints no value`
      : `sets a part on the split part "${source}", which prints a piece of the raw value`
  }
  if (!form) return `prints the part "${part}", which needs the artifact's declarations to read`
  const declared = bindingDeclaration(form, only.source)
  const what = declared ? `${declared.path}, ${/^[aeiou]/.test(declared.kind) ? 'an' : 'a'} ${declared.kind} value` : `"${only.source}", which the artifact does not declare`
  if (!isValuePart(part)) return `has the part ${JSON.stringify(part)}, which is none of ${ALL_VALUE_PARTS.map((name) => JSON.stringify(name)).join(', ')}`
  const parts = declared && partsOf(declared.kind)
  if (!parts) return `prints the part "${part}" of ${what}; only date, phone and money values have parts`
  return parts.includes(part) ? undefined : `prints the part "${part}" of ${what}, whose parts are ${parts.map((name) => JSON.stringify(name)).join(', ')}`
}

/**
 * Refuse any binding whose format or part cannot apply.
 * @throws {PdfBindingSyntaxError} naming the first such binding.
 */
export function assertBindingFormats(form: Form | undefined, bindings: readonly ParsedPdfBinding[]): void {
  for (const binding of bindings) {
    const problem = bindingFormatProblem(form, binding) ?? bindingPartProblem(form, binding)
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

export function artifactPath(source: string): string {
  return renderDataPath({ fields: {} }, source)
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

/**
 * Thrown before filling when a print of the layer fails for some value the
 * artifact accepts, naming the PDF field (or the field filled by its id) and
 * what the artifact needs. `validate()` reports the same problem first.
 */
export class PdfPrintRuleError extends Error {
  /** The binding key, or undefined for a field the layer fills by its id. */
  readonly binding?: string

  constructor(found: LayerPrintProblem) {
    super(`${found.binding === undefined ? 'The PDF layer' : `PDF field ${JSON.stringify(found.binding)}`} ${found.problem}.`)
    this.name = 'PdfPrintRuleError'
    if (found.binding !== undefined) this.binding = found.binding
  }
}

/** A print of a PDF layer that fails for some value the artifact accepts. */
export interface LayerPrintProblem {
  /** The binding key, when one binding prints the value. */
  binding?: string
  /** True for a list whose bound rows cannot hold every item it accepts. */
  rows?: true
  /** What fails and what the artifact needs, worded to follow the binding or the field. */
  problem: string
}

function bindingPrintProblems(form: Form, value: BindingValue, format: LayerFormat | undefined): string[] {
  let parsed: ParsedPdfBinding
  try {
    parsed = parseBinding(value)
  } catch (error) {
    if (error instanceof PdfBindingSyntaxError) return []
    throw error
  }
  const effective = mergeFormats<ValueFormat>(format, parsed.format)
  if (parsed.template) {
    return parsed.template.slots.flatMap((slot) => {
      const source = templateSlotPart(slot.segments)
      const problem = source && printProblem(bindingDeclaration(form, source.source), slot.part, mergeFormats(effective, slot.format))
      return problem ? [`prints {{${slot.source}}}, but ${problem}`] : []
    })
  }
  const [only] = parsed.parts
  if (parsed.parts.length !== 1 || only!.qualifier !== undefined) return []
  const problem = printProblem(bindingDeclaration(form, only!.source), parsed.part, effective)
  return problem ? [`prints ${only!.source}, but ${problem}`] : []
}

function boundPaths(bindings: Bindings): string[][] {
  return Object.values(bindings).flatMap((value) => {
    try {
      return parseBinding(value).parts.map((part) => pathSegments(part.path))
    } catch (error) {
      if (error instanceof PdfBindingSyntaxError) return []
      throw error
    }
  })
}

const isRow = (segment: string | undefined): segment is string => segment !== undefined && /^\d+$/.test(segment)

interface BoundLists {
  rows: Map<string, { field: Extract<FormField, { type: 'list' }>; fewest: number }>
  problems: Map<string, string>
}

function walkBoundRows(field: FormField, path: string, paths: readonly string[][], depth: number, found: BoundLists): void {
  if (field.type === 'fieldset') {
    for (const [key, child] of Object.entries(field.fields)) {
      walkBoundRows(child, `${path}.${key}`, paths.filter((segments) => segments[depth] === key), depth + 1, found)
    }
    return
  }
  if (field.type !== 'list') return
  const rows = new Map<number, Set<string>>()
  for (const segments of paths) {
    const row = segments[depth]
    if (!isRow(row)) continue
    const members = rows.get(Number(row)) ?? new Set<string>()
    members.add(segments.slice(depth + 1).join('.'))
    rows.set(Number(row), members)
  }
  if (rows.size === 0) return
  const dead = [...rows.keys()].filter((row) => field.maxItems !== undefined && row >= field.maxItems).sort((left, right) => left - right)
  if (dead.length > 0) {
    found.problems.set(`${path}:dead`, `binds row ${dead.map((row) => row + 1).join(', ')} of ${path}, past its "maxItems": ${field.maxItems}, so ${dead.length === 1 ? 'that row never fills' : 'those rows never fill'}; remove ${dead.length === 1 ? 'its' : 'their'} bindings, or raise maxItems`)
  }
  for (const row of dead) rows.delete(row)
  if (rows.size === 0) return
  const count = Math.max(...rows.keys()) + 1
  const missing = Array.from({ length: count }, (_, row) => row).filter((row) => !rows.has(row))
  if (missing.length > 0) {
    found.problems.set(`${path}:gap`, `binds rows of ${path} up to row ${count}, but not row ${missing.map((row) => row + 1).join(', ')}; bind every row from the first`)
  }
  const first = field.item.type === 'list' ? undefined : rows.get(0)
  for (const [row, members] of first ? rows : []) {
    const lacking = [...first!].filter((member) => !members.has(member))
    if (lacking.length > 0) {
      found.problems.set(`${path}:members`, `binds ${lacking.map((member) => member === '' ? 'the value' : member).join(', ')} in row 1 of ${path} but not in row ${row + 1}; bind the same members in every row`)
      break
    }
  }
  const known = found.rows.get(path)
  found.rows.set(path, { field, fewest: Math.min(rows.size, known?.fewest ?? rows.size) })
  for (const row of rows.keys()) walkBoundRows(field.item, `${path}[]`, paths.filter((segments) => segments[depth] === String(row)), depth + 1, found)
}

/**
 * Each list a PDF layer binds by row that can hold more items than the layer
 * has rows for, binds its rows with a gap, or binds fewer members in a later
 * row than in the first, among the rows below `maxItems`. A row at or past
 * `maxItems` holds no item: its bindings are reported as dead. A nested list needs `maxItems` within the fewest
 * rows bound under any outer row.
 */
function boundListProblems(form: Form, bindings: Bindings): string[] {
  const paths = boundPaths(bindings)
  const found: BoundLists = { rows: new Map(), problems: new Map() }
  for (const [key, field] of Object.entries(form.fields ?? {})) {
    walkBoundRows(field, `fields.${key}`, paths.filter((segments) => segments[0] === key), 1, found)
  }
  const capacity = [...found.rows].flatMap(([path, { field, fewest }]) => field.maxItems !== undefined && field.maxItems <= fewest
    ? []
    : [`binds ${fewest} row${fewest === 1 ? '' : 's'} of ${path}, and the field accepts ${field.maxItems === undefined ? 'any number of items' : `${field.maxItems} items`}; give it "maxItems": ${fewest}, or bind more rows`])
  return [...found.problems.values(), ...capacity]
}

/**
 * Each print of a PDF layer that fails for some value the artifact accepts,
 * so no data can be relied on to print: a phone part or a `phone.region`
 * style on a phone field whose `countryCode` does not hold it, or a money
 * part on a money field that accepts other currencies or amounts below zero.
 * `bindings` are the layer's resolved bindings; without them each top-level
 * field the layer fills by its id is checked under `format`.
 */
export function layerPrintProblems(form: Form, bindings: Bindings | undefined, format: LayerFormat | undefined): LayerPrintProblem[] {
  if (bindings) {
    return [
      ...Object.entries(bindings).flatMap(([binding, value]) => bindingPrintProblems(form, value, format).map((problem) => ({ binding, problem }))),
      ...boundListProblems(form, bindings).map((problem) => ({ rows: true as const, problem })),
    ]
  }
  return Object.entries(form.fields ?? {}).flatMap(([name, field]) => {
    if (field.type === 'fieldset') return []
    const problem = printProblem({ source: 'field', kind: field.type, field, path: `fields.${name}` }, undefined, format)
    return problem ? [{ problem: `prints fields.${name}, but ${problem}` }] : []
  })
}
