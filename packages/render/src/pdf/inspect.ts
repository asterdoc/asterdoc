import type { BinaryContent, Bindings } from '@asterdoc/types'
import { parseBindings } from '../layer-bindings'
import { acroFields, choiceOptions, radioStates, textFieldDrawing, textValue, type PdfFieldType } from './acroform'
import { documentPages } from './page-tree'
import { isDict, isRef, PdfModel } from './syntax'

export type { PdfFieldType } from './acroform'

/** One option of a dropdown, a list box or a radio group. */
export interface PdfFieldOption {
  /** The value the PDF stores for the option. A binding must write this value. */
  value: string
  /** The text a viewer shows for the option. For a radio group it is the value. */
  label: string
}

export interface PdfFieldInfo {
  name: string
  type: PdfFieldType
  value?: string | boolean | string[]
  /** For a dropdown, a list box or a radio group: its options, in the order of the PDF. */
  options?: PdfFieldOption[]
  required?: boolean
  page?: number
  rect?: [number, number, number, number]
  maxLen?: number | null
  /** For a text field: whether it prints several lines, so a binding template's line break starts a new line. */
  multiline?: boolean
  /** Every widget of the field, in the order of the PDF. A value fills each one. `page` and `rect` are the first one's. */
  widgets: PdfFieldWidget[]
}

/** One place on a page where a field shows its value. */
export interface PdfFieldWidget {
  /** One-based page number, when the PDF says where the widget is. */
  page?: number
  rect?: [number, number, number, number]
}

export interface InspectOptions {
  includeButton?: boolean
  includeSignature?: boolean
}

export interface PdfPageInfo {
  /** One-based page number. */
  page: number
  /** Page width in PDF points. */
  width: number
  /** Page height in PDF points. */
  height: number
}

export interface PdfInfo {
  pageCount: number
  pages: PdfPageInfo[]
}

/** Inspect page count and dimensions without loading a full PDF toolkit. */
export async function inspectPdf(template: BinaryContent): Promise<PdfInfo> {
  const model = await PdfModel.load(template)
  const pages = documentPages(model).map(({ inherited }, index): PdfPageInfo => {
    const box = model.resolve(inherited.get('MediaBox'))
    if (!Array.isArray(box) || box.length !== 4 || !box.every((item) => typeof item === 'number')) {
      throw new Error(`PDF page ${index + 1} has no readable MediaBox`)
    }
    const [left, bottom, right, top] = box as [number, number, number, number]
    return { page: index + 1, width: right - left, height: top - bottom }
  })
  return { pageCount: pages.length, pages }
}

/** List the AcroForm fields a PDF declares, walked as fill walks them. */
export async function inspectAcroFormFields(
  template: BinaryContent,
  options: InspectOptions = {},
): Promise<PdfFieldInfo[]> {
  const model = await PdfModel.load(template)
  const form = acroFields(model)
  if (!form) return []
  const pageOfWidget = widgetPages(model)
  const result: PdfFieldInfo[] = []

  for (const field of form.fields) {
    const { type, flags } = field
    if (type === 'button' && !options.includeButton) continue
    if (type === 'signature' && !options.includeSignature) continue
    const rawValue = model.resolve(field.dict.entries.get('V'))
    let fieldValue: string | boolean | string[] | undefined
    if (type === 'checkbox') {
      const state = textValue(rawValue)
      fieldValue = state !== undefined && state !== 'Off'
    } else if (type === 'dropdown') {
      const selected = Array.isArray(rawValue) ? rawValue : rawValue === undefined ? [] : [rawValue]
      fieldValue = selected.map(textValue).filter((item): item is string => item !== undefined)
    } else if (Array.isArray(rawValue)) fieldValue = rawValue.map(textValue).filter((item): item is string => item !== undefined)
    else fieldValue = textValue(rawValue)

    const widgets = field.widgets.map((widget): PdfFieldWidget => {
      const rectangle = model.resolve(widget.dict.entries.get('Rect'))
      const rect = Array.isArray(rectangle) && rectangle.length === 4 && rectangle.every((item) => typeof item === 'number')
        ? rectangle as [number, number, number, number]
        : undefined
      const page = pageOfWidget(widget)
      return { ...(page !== undefined && { page }), ...(rect && { rect }) }
    })
    const { page, rect } = widgets[0] ?? {}

    const choices = type === 'dropdown'
      ? choiceOptions(model, field).map(({ value, display }) => ({ value, label: display }))
      : type === 'radio' ? radioStates(model, field).map((state) => ({ value: state, label: state })) : undefined

    result.push({
      name: field.name,
      type,
      value: fieldValue,
      ...(choices && { options: choices }),
      required: type === 'text' || type === 'checkbox' || type === 'dropdown' || type === 'radio'
        ? (flags & 2) !== 0
        : undefined,
      page,
      rect,
      maxLen: type === 'text' ? field.maxLength ?? null : undefined,
      ...(type === 'text' && { multiline: textFieldDrawing(field).multiline }),
      widgets,
    })
  }
  return result
}

type AcroWidget = NonNullable<ReturnType<typeof acroFields>>['fields'][number]['widgets'][number]

function widgetPages(model: PdfModel): (widget: AcroWidget) => number | undefined {
  const pageOf = new Map<number, number>()
  const annotationPage = new Map<number, number>()
  documentPages(model).forEach(({ ref, record }, index) => {
    pageOf.set(ref.object, index + 1)
    const annotations = isDict(record.value) ? model.resolve(record.value.entries.get('Annots')) : undefined
    if (!Array.isArray(annotations)) return
    for (const annotation of annotations) if (isRef(annotation)) annotationPage.set(annotation.object, index + 1)
  })
  return (widget) => {
    const parent = widget.dict.entries.get('P')
    return (isRef(parent) ? pageOf.get(parent.object) : undefined) ?? (widget.ref ? annotationPage.get(widget.ref.object) : undefined)
  }
}

function fieldPages(model: PdfModel): Map<string, number[]> {
  const form = acroFields(model)
  const result = new Map<string, number[]>()
  if (!form) return result
  const pageOfWidget = widgetPages(model)
  for (const field of form.fields) {
    const pages = new Set<number>()
    for (const widget of field.widgets) {
      const page = pageOfWidget(widget)
      if (page !== undefined) pages.add(page)
    }
    if (pages.size > 0) result.set(field.name, [...pages].sort((a, b) => a - b))
  }
  return result
}

/** Options for {@link pdfBindingPages}. */
export interface PdfBindingPagesOptions {
  /** The PDF layer's bytes. */
  template: BinaryContent
  /** The layer's bindings. */
  bindings: Bindings
}

/**
 * The pages of a PDF layer each bound path prints on: for every path a
 * binding reads, the one-based pages that hold a widget of a field it fills,
 * in page order. The key is the path as fill data holds it, without the
 * `fields` root, such as `mailingAddress.line1` or `parties.buyer.name`.
 *
 * Nothing is read from the artifact but its bindings, and nothing is written:
 * a page number belongs to the layer, not to the field.
 *
 * @throws {PdfBindingSyntaxError} when a binding cannot be parsed.
 */
export async function pdfBindingPages({ template, bindings }: PdfBindingPagesOptions): Promise<Map<string, number[]>> {
  const pages = fieldPages(await PdfModel.load(template))
  const byPath = new Map<string, Set<number>>()
  for (const { field, parts } of parseBindings(bindings)) {
    const found = pages.get(field)
    if (!found) continue
    for (const { path } of parts) {
      const set = byPath.get(path) ?? new Set<number>()
      for (const page of found) set.add(page)
      byPath.set(path, set)
    }
  }
  return new Map([...byPath].map(([path, set]) => [path, [...set].sort((a, b) => a - b)]))
}
