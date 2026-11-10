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
import { printValuePart } from '../parts/print'
import { acroFields, setAcroFieldValue, type AcroField } from './acroform'
import { PdfFontSet, type PdfFont } from './drawing-fonts'
import { applyPdfOverlays, type PdfOverlay } from './overlay'
import { PdfModel } from './syntax'

export interface RenderPdfOptions {
  template: BinaryContent
  form?: Form
  data: Record<string, unknown>
  /** AcroForm field name to Asterdoc path, as a string or a binding object with its own format. */
  bindings?: Bindings
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

function assign(field: AcroField | undefined, value: unknown, model: PdfModel, fonts: PdfFontSet): void {
  if (!field || value === null || value === undefined) return
  setAcroFieldValue(model, fonts, field, field.type === 'checkbox' || field.type === 'radio' || field.type === 'dropdown'
    ? unwrapFormattedValue(value)
    : value)
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
  formatter = defaultFormatter,
  overlays = [],
  font,
  layerFont,
  format,
}: RenderPdfOptions): Promise<BinaryContent> {
  const parsed = parseBindings(bindings ?? {})
  const perValue = form !== undefined && (
    hasNewFormatOptions(format) ||
    Object.values(bindings ?? {}).some(declaresFormat) ||
    readsMaskedField(form, parsed, bindings, overlays)
  )
  const preprocessed = form && !perValue
    ? formatFieldData(data, form, formatter, formatFieldOptions(format, { choices: 'value' }))
    : data
  if (form) {
    const sources = parsed.flatMap(({ parts }) => parts.map((part) => part.source))
    sources.push(...overlays.flatMap((overlay) => 'field' in overlay && overlay.field ? [overlay.field] : []))
    validateFieldBindings(form, Object.fromEntries(sources.map((source, index) => [String(index), source])))
  }
  assertBindingFormats(form, parsed)
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
  const layerCasedPart = (part: string, definition: FormField | undefined): string =>
    format?.case === 'upper' && !CASE_KEEPING_TYPES.has(definition?.type ?? '') ? part.toLocaleUpperCase(caseLocale(undefined)) : part
  const caseLocale = (bindingFormat: ValueFormat | undefined) => formatterFor(formatter, mergeFormats(format, bindingFormat)).locale
  const bindingCase = (value: unknown, bindingFormat: ValueFormat | undefined): unknown =>
    bindingFormat?.case === undefined ? value : bindingCased(value, bindingFormat, caseLocale(bindingFormat))
  assertListBindingCapacity(form, data, parsed)
  const model = await PdfModel.load(template)
  const fonts = PdfFontSet.create(model, { font, layerFont })
  let droppedXfa = false
  const shouldFill = parsed.length > 0 || Boolean(form?.fields && Object.keys(form.fields).length > 0)

  if (shouldFill) {
    // Ordinary PDFs can still receive coordinate overlays without AcroForm fields.
    const acroFormData = acroFields(model)

    const byName = new Map((acroFormData?.fields ?? []).map((field) => [field.name, field]))
    const unmatched = parsed.map(({ field }) => field).filter((pdfName) => !byName.has(pdfName))
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
      // Bindings given, even none, replace filling PDF fields by field id.
      if (bindings) {
        for (const { field: pdfName, parts, format: bindingFormat, part: valuePart } of parsed) {
          const field = byName.get(pdfName)
          if (parts.length > 1) {
            const combined = parts.map((part) => read(part.source, bindingFormat)).filter((value) => value !== null && value !== undefined && String(value) !== '').join(', ')
            if (combined) assign(field, bindingCase(combined, bindingFormat), model, fonts)
            continue
          }
          const { path, qualifier } = parts[0]!
          if (qualifier !== undefined) {
            const value = getPath(data, renderDataPath(data, parts[0]!.source))
            if (typeof value === 'boolean') assign(field, value, model, fonts)
            else if (Array.isArray(value)) assign(field, value.includes(qualifier), model, fonts)
            else if (fieldDefinition(form, path)?.type === 'enum') assign(field, String(value) === qualifier, model, fonts)
            else {
              const index = splitPartIndex(qualifier)
              if (index !== undefined && value !== null && value !== undefined) {
                const definition = fieldDefinition(form, path)
                const part = splitPart(definition, value, index, definition ? `fields.${path}` : renderDataPath(data, parts[0]!.source))
                if (part) assign(field, layerCasedPart(part, definition), model, fonts)
              }
            }
            continue
          }
          assign(field, bindingCase(read(parts[0]!.source, bindingFormat, valuePart), bindingFormat), model, fonts)
        }
      } else if (form) {
        for (const [name, definition] of Object.entries(form.fields ?? {}) as [string, FormField][]) {
          if (definition.type === 'fieldset') continue
          if (perValue && !byName.has(name)) continue
          const value = perValue
            ? read(name) ?? data[name]
            : (preprocessed.fields as Record<string, unknown> | undefined)?.[name] ?? preprocessed[name]
          assign(byName.get(name), value, model, fonts)
        }
      }
    }
  }

  applyPdfOverlays(model, overlays, (path) => read(path), fonts)
  fonts.finish()
  return droppedXfa ? model.rewrite() : model.save()
}
