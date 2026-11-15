import { defaultFormatter } from '../default-formatter'
import { MASK_MISMATCH, formatMasked, maskGroup } from '@asterdoc/format'
import type { BinaryContent, Bindings, Form, FormField, Formatter, LayerFormat, ValueFormat, ValuePart } from '@asterdoc/types'
import {
  ArtifactFieldFormatError,
  FormattedFieldValue,
  formatFieldData,
  formatValueAt,
  validateFieldBindings,
  unwrapFormattedValue,
  withoutSensitiveValues,
} from '../text/field-formatter'
import { getPath, pathSegments } from '../path'
import {
  artifactPath,
  assertBindingFormats,
  bindingDataPath,
  containsMask,
  fieldDefinition,
  parseBindings,
  PdfBindingKeyError,
  renderDataPath,
  splitPartIndex,
  type ParsedLayerBinding,
} from '../layer-bindings'
import { formatFieldOptions, formatterFor, hasNewFormatOptions, mergeFormats } from '../presentation'
import { bindingDeclaration } from '../parts/rules'
import type { TemplateExpressionOptions } from '../template/context'
import { printValuePart } from '../parts/print'
import { acroFields, setAcroFieldValue, type AcroField } from './acroform'
import { bindingTemplatePrinter } from './binding-template'
import { PdfFontSet, type PdfFont } from './drawing-fonts'
import { PdfFieldFillError } from './field-appearance'
import { applyPdfOverlays, type PdfOverlay } from './overlay'
import { PdfModel } from './syntax'

export interface RenderPdfOptions {
  template: BinaryContent
  form?: Form
  data: Record<string, unknown>
  /** AcroForm field name to Asterdoc path, as a string, or a binding object with its own format, part, or template. */
  bindings?: Bindings
  /** The expression context and configured functions binding templates read. */
  expressions?: TemplateExpressionOptions
  formatter?: Formatter
  overlays?: PdfOverlay[]
  /**
   * A font supplied at render time. It is tried first for every text value,
   * ahead of the layer's declared font.
   */
  font?: PdfFont
  /** The font the artifact's PDF layer declares, tried after `font`. */
  layerFont?: PdfFont
  /**
   * How the artifact's PDF layer prints values, applied over `formatter`, with
   * each binding's own format merged over it. `{ money: { currencyDisplay:
   * 'none' } }` prints amounts without a symbol beside a template's
   * pre-printed one.
   */
  format?: LayerFormat
}

export function assignedValue(field: AcroField, value: unknown): unknown {
  return field.type === 'checkbox' || field.type === 'radio' || field.type === 'dropdown'
    ? unwrapFormattedValue(value)
    : value
}

function declaresFormat(binding: Bindings[string]): boolean {
  return typeof binding === 'object' && binding !== null && (binding.format !== undefined || binding.part !== undefined)
}

function readsMaskedField(
  form: Form,
  parsed: readonly ParsedLayerBinding[],
  bindings: Bindings | undefined,
  overlays: readonly PdfOverlay[],
): boolean {
  const paths = bindings
    ? parsed.flatMap(({ parts }) => parts.map((part) => part.path))
    : Object.entries(form.fields ?? {}).filter(([, field]) => field.type !== 'fieldset').map(([name]) => name)
  paths.push(...overlays.flatMap((overlay) => 'field' in overlay && overlay.field ? [bindingDataPath(overlay.field)] : []))
  return paths.some((path) => containsMask(fieldDefinition(form, path)))
}

/** The text a `:N` split binding prints: the Nth group of a masked value, or else the Nth hyphen-separated part. */
function splitPart(field: FormField | undefined, value: unknown, index: number, path: string): string | undefined {
  if (field?.type !== 'text' || field.mask === undefined) return String(value).split('-')[index]
  const fits = formatMasked(field.mask, String(value))
  if (!fits.success) throw new ArtifactFieldFormatError(path, 'text', 'invalid', [{ code: MASK_MISMATCH, message: fits.message, redactedMessage: fits.redactedMessage, path, kind: 'text' }])
  const group = maskGroup(field.mask, String(value), index)
  return group.success ? group.value : undefined
}

const CASE_KEEPING_TYPES = new Set(['email', 'uri', 'uuid'])

function bindingCased(value: unknown, format: ValueFormat | undefined, locale: string): unknown {
  if (format?.case !== 'upper' || value === null || value === undefined) return value
  const text = String(value)
  if (text === '') return value
  return new FormattedFieldValue(unwrapFormattedValue(value), text.toLocaleUpperCase(locale))
}

function sourcePaths(bindings: readonly ParsedLayerBinding[]): string[][] {
  return bindings.flatMap(({ parts }) => parts.map((part) => pathSegments(part.path)))
}

function displayPath(segments: string[]): string {
  return segments.reduce((path, segment) => /^\d+$/.test(segment)
    ? `${path}[${segment}]`
    : path ? `${path}.${segment}` : segment, '')
}

function assertListBindingCapacity(
  form: Form | undefined,
  data: Record<string, unknown>,
  bindings: readonly ParsedLayerBinding[],
): void {
  if (!form?.fields || bindings.length === 0) return
  const paths = sourcePaths(bindings)

  const visit = (field: FormField, value: unknown, prefix: string[]): void => {
    if (field.type === 'list') {
      if (!Array.isArray(value)) return
      const indices = paths
        .filter((path) => prefix.every((segment, index) => path[index] === segment))
        .map((path) => path[prefix.length])
        .filter((segment): segment is string => segment !== undefined && /^\d+$/.test(segment))
        .map(Number)
      if (indices.length > 0) {
        const capacity = Math.max(...indices) + 1
        if (value.length > capacity) {
          throw new Error(`PDF bindings for "${displayPath(prefix)}" support ${capacity} list items, but received ${value.length}`)
        }
      }
      value.forEach((item, index) => visit(field.item, item, [...prefix, String(index)]))
      return
    }

    if (field.type === 'fieldset' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, nestedField] of Object.entries(field.fields)) {
        visit(nestedField, (value as Record<string, unknown>)[key], [...prefix, key])
      }
    }
  }

  for (const [key, field] of Object.entries(form.fields)) visit(field, data[key], [key])
}

interface DataValues {
  data: Record<string, unknown>
  preprocessed: Record<string, unknown>
  read(source: string, bindingFormat?: ValueFormat, part?: ValuePart): unknown
  printTemplate(binding: ParsedLayerBinding): string | undefined
}

interface BoundValue {
  field: string
  paths: string[]
  value(values: DataValues): unknown
}

type LayerValuesOptions = Pick<RenderPdfOptions, 'form' | 'bindings' | 'formatter' | 'overlays' | 'format'>

export function layerValues({ form, bindings, formatter = defaultFormatter, overlays = [], format }: LayerValuesOptions) {
  const parsed = parseBindings(bindings ?? {})
  const perValue = form !== undefined && (
    hasNewFormatOptions(format) ||
    Object.values(bindings ?? {}).some(declaresFormat) ||
    readsMaskedField(form, parsed, bindings, overlays)
  )
  let asserted = false
  const assertBindings = (): void => {
    if (asserted) return
    if (form) {
      const sources = parsed.flatMap(({ parts }) => parts.map((part) => part.source))
      sources.push(...overlays.flatMap((overlay) => 'field' in overlay && overlay.field ? [overlay.field] : []))
      validateFieldBindings(form, Object.fromEntries(sources.map((source, index) => [String(index), source])))
    }
    assertBindingFormats(form, parsed)
    asserted = true
  }
  const caseLocale = (bindingFormat: ValueFormat | undefined) => formatterFor(formatter, mergeFormats(format, bindingFormat)).locale
  const layerCasedPart = (part: string, definition: FormField | undefined): string =>
    format?.case === 'upper' && !CASE_KEEPING_TYPES.has(definition?.type ?? '') ? part.toLocaleUpperCase(caseLocale(undefined)) : part
  const bindingCase = (value: unknown, bindingFormat: ValueFormat | undefined): unknown =>
    bindingFormat?.case === undefined ? value : bindingCased(value, bindingFormat, caseLocale(bindingFormat))

  const bindingValue = (binding: ParsedLayerBinding): BoundValue['value'] => ({ data, read, printTemplate }) => {
    if (binding.template) return printTemplate(binding)
    const { parts, format: bindingFormat, part: valuePart } = binding
    const { path, qualifier, source } = parts[0]!
    if (qualifier === undefined) return bindingCase(read(source, bindingFormat, valuePart), bindingFormat)
    const value = getPath(data, renderDataPath(data, source))
    if (typeof value === 'boolean') return value
    if (Array.isArray(value)) return value.includes(qualifier)
    const definition = fieldDefinition(form, path)
    if (definition?.type === 'enum') return String(value) === qualifier
    const index = splitPartIndex(qualifier)
    if (index === undefined || value === null || value === undefined) return undefined
    const part = splitPart(definition, value, index, definition ? `fields.${path}` : renderDataPath(data, source))
    return part ? layerCasedPart(part, definition) : undefined
  }

  // Bindings given, even none, replace filling PDF fields by field id.
  const bound: BoundValue[] = bindings
    ? parsed.map((binding) => ({
        field: binding.field,
        paths: [...new Set(binding.parts.map((part) => artifactPath(part.source)))],
        value: bindingValue(binding),
      }))
    : (Object.entries(form?.fields ?? {}) as [string, FormField][])
        .filter(([, definition]) => definition.type !== 'fieldset')
        .map(([name]) => ({
          field: name,
          paths: [`fields.${name}`],
          value: ({ data, preprocessed, read }) => perValue
            ? read(name) ?? data[name]
            : (preprocessed.fields as Record<string, unknown> | undefined)?.[name] ?? preprocessed[name],
        }))

  return {
    parsed,
    bound,
    fills: parsed.length > 0 || Boolean(form?.fields && Object.keys(form.fields).length > 0),
    of(data: Record<string, unknown>, expressions?: TemplateExpressionOptions): DataValues {
      const preprocessed = form && !perValue
        ? formatFieldData(data, form, formatter, formatFieldOptions(format, { choices: 'value' }))
        : data
      assertBindings()
      const read = (source: string, bindingFormat?: ValueFormat, part?: ValuePart): unknown => {
        if (!form || !perValue) return getPath(preprocessed, renderDataPath(preprocessed, source))
        const effective = mergeFormats(format, bindingFormat)
        if (part !== undefined) {
          const declared = bindingDeclaration(form, source)!
          return printValuePart(formatterFor(formatter, effective), declared.kind, getPath(data, renderDataPath(data, source)), part, declared.path, { ...(effective?.phone && { phone: effective.phone }) })
        }
        const options = formatFieldOptions(effective, { choices: 'value' })
        if (bindingFormat?.case !== undefined) delete options.case
        return formatValueAt(data, form, formatterFor(formatter, effective), source, options)
      }
      const printTemplate = bindingTemplatePrinter({ data, form, formatter, format, expressions })
      assertListBindingCapacity(form, data, parsed)
      return { data, preprocessed, read, printTemplate }
    },
  }
}

export async function renderPdf(options: RenderPdfOptions): Promise<BinaryContent> {
  try {
    return await renderPdfWithValues(options)
  } catch (error) {
    throw withoutSensitiveValues(options.form, error)
  }
}

async function renderPdfWithValues({
  template,
  form,
  data,
  bindings,
  expressions,
  formatter = defaultFormatter,
  overlays = [],
  font,
  layerFont,
  format,
}: RenderPdfOptions): Promise<BinaryContent> {
  const layer = layerValues({ form, bindings, formatter, overlays, format })
  const values = layer.of(data, expressions)
  const model = await PdfModel.load(template)
  const fonts = PdfFontSet.create(model, { font, layerFont })
  let droppedXfa = false

  if (layer.fills) {
    // Ordinary PDFs can still receive coordinate overlays without AcroForm fields.
    const acroFormData = acroFields(model)

    const byName = new Map((acroFormData?.fields ?? []).map((field) => [field.name, field]))
    const unmatched = layer.parsed.map(({ field }) => field).filter((pdfName) => !byName.has(pdfName))
    if (unmatched.length > 0) {
      throw new PdfBindingKeyError(unmatched, [...byName.keys()])
    }

    if (acroFormData) {
      const { acroForm, acroRef, catalogRef } = acroFormData
      await fonts.readFormFonts(model.dict(acroForm.entries.get('DR')))
      // Every filled value carries its own appearance, drawn in the font
      // chosen for it. A viewer told to regenerate appearances would redraw
      // them in the form's default font instead.
      acroForm.entries.delete('NeedAppearances')
      droppedXfa = acroForm.entries.delete('XFA')
      model.markUpdated(acroRef ?? catalogRef)
      if (model.dict(catalogRef)?.entries.delete('NeedsRendering')) model.markUpdated(catalogRef)
      for (const bound of layer.bound) {
        const field = byName.get(bound.field)
        if (!field) continue
        const value = bound.value(values)
        if (value === null || value === undefined) continue
        try {
          setAcroFieldValue(model, fonts, field, assignedValue(field, value))
        } catch (error) {
          throw error instanceof PdfFieldFillError ? error.withPaths(bound.paths) : error
        }
      }
    }
  }

  applyPdfOverlays(model, overlays, (path) => values.read(path), fonts)
  fonts.finish()
  return droppedXfa ? model.rewrite() : model.save()
}
