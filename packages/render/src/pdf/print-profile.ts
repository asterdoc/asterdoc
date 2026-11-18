import type { BinaryContent, Bindings, Form, Formatter, LayerFormat, RendererExpressions, StandardPdfFont } from '@asterdoc/types'
import { defaultFormatter } from '../default-formatter'
import { requestExpressions } from '../template/context'
import { ArtifactFieldFormatError, withoutSensitiveValues } from '../text/field-formatter'
import { acroFields, choiceDrawing, choiceOptions, textFieldDrawing, widgetLayout } from './acroform'
import { measureRuns, measuringFaces, parseSupplied, type MeasuringFaces, type PdfFont } from './drawing-fonts'
import { layoutFieldText, PdfFieldFillError, type DefaultAppearance, type FieldLayout } from './field-appearance'
import { bindingFonts, PdfBindingKeyError } from '../layer-bindings'
import { assignedValue, layerValues } from './render'
import { PdfModel } from './syntax'

interface FieldProfile {
  name: string
  type: 'text' | 'dropdown' | 'other'
  flags: number
  options: Array<{ value: string; display: string }>
  /** One per widget with a usable rectangle; a dropdown's layout is taken per value. */
  widgets: Array<(value: { multiline: boolean; comb?: number }) => FieldLayout & { appearance: DefaultAppearance }>
  textLayouts: Array<FieldLayout & { appearance: DefaultAppearance }>
}

/**
 * What validation needs from one PDF layer to tell whether data prints, read
 * once when the form loads: each AcroForm field's boxes, sizes, comb and
 * multi-line settings, and the faces a value can be drawn in. It holds no PDF
 * model, so checking reads no file.
 */
export interface PdfPrintProfile {
  readonly form: Form
  readonly bindings?: Bindings
  readonly format?: LayerFormat
  readonly fields: ReadonlyMap<string, FieldProfile>
  readonly faces: MeasuringFaces
}

/** What {@link readPdfPrintProfile} reads. */
export interface ReadPdfPrintProfileOptions {
  template: BinaryContent
  form: Form
  /** The layer's resolved bindings; without them fields fill by their id. */
  bindings?: Bindings
  format?: LayerFormat
  /** The TrueType font the layer declares. */
  layerFont?: PdfFont
  /** The standard font the layer declares. */
  standardFont?: StandardPdfFont
}

/**
 * Read a PDF layer's print profile.
 *
 * @throws {PdfFontError} when the layer's font cannot be used, naming its source.
 */
export async function readPdfPrintProfile({ template, form, bindings, format, layerFont, standardFont }: ReadPdfPrintProfileOptions): Promise<PdfPrintProfile> {
  const model = await PdfModel.load(template)
  const acro = acroFields(model)
  const fields = new Map<string, FieldProfile>()
  for (const field of acro?.fields ?? []) {
    const type = field.type === 'text' || field.type === 'dropdown' ? field.type : 'other'
    const drawing = textFieldDrawing(field)
    const usable = field.widgets.filter((widget) => widgetLayout(model, field, widget, drawing) !== undefined)
    const layouts = usable.map((widget) => {
      const base = widgetLayout(model, field, widget, drawing)!
      return (value: { multiline: boolean; comb?: number }) => ({ ...base, multiline: value.multiline, comb: value.comb })
    })
    fields.set(field.name, {
      name: field.name,
      type,
      flags: field.flags,
      options: type === 'dropdown' ? choiceOptions(model, field) : [],
      widgets: layouts,
      textLayouts: layouts.map((layout) => layout(drawing)),
    })
  }
  const layer = layerValues({ form, bindings, formatter: defaultFormatter, format })
  const unmatched = layer.fills ? layer.parsed.map(({ field }) => field).filter((name) => !fields.has(name)) : []
  if (unmatched.length > 0) throw new PdfBindingKeyError(unmatched, [...fields.keys()])
  return {
    form,
    ...(bindings && { bindings }),
    ...(format && { format }),
    fields,
    faces: measuringFaces({
      ...(layerFont && { layer: parseSupplied(layerFont) }),
      ...(standardFont && { standard: standardFont }),
      fieldFonts: bindingFonts(bindings),
    }),
  }
}

/** A value a PDF layer cannot print, as a render of the same data would refuse it. */
export interface PdfPrintFailure {
  /** The AcroForm field, or undefined when the layer's values could not be read at all. */
  field?: string
  /** The artifact paths the field prints, as fill data names them: `fields.fullName`. */
  paths: readonly string[]
  /** What fails, without the field name. */
  message: string
  /** The error a render of the same data throws. */
  error: Error
}

/** What {@link pdfPrintFailures} checks: the form's data, as a render request carries it. */
export interface PdfPrintData {
  data: Record<string, unknown>
  /** The expression context binding templates read, as a render request carries it. */
  expressions?: RendererExpressions
  formatter?: Formatter
}

function failureOf(form: Form, raw: unknown, paths: readonly string[], field?: string): PdfPrintFailure | undefined {
  const error = withoutSensitiveValues(form, raw)
  if (error instanceof PdfFieldFillError) {
    const named = error.withPaths(paths)
    return { field: named.field, paths: named.paths ?? [], message: named.message, error: named }
  }
  if (error instanceof ArtifactFieldFormatError) return { ...(field && { field }), paths: [error.path], message: error.message, error }
  if (error instanceof Error) return { ...(field && { field }), paths, message: error.message, error }
  return undefined
}

/**
 * Each value of `data` that a render of this layer would refuse: a format the
 * value cannot take, a character no font of the layer can draw, a script that
 * needs shaping, a value that does not fit its box at the minimum size, or
 * more characters than a comb field has boxes. It measures with the code
 * rendering draws with, and reads no file. An empty list means the data prints.
 */
export function pdfPrintFailures(profile: PdfPrintProfile, { data, expressions, formatter = defaultFormatter }: PdfPrintData): PdfPrintFailure[] {
  const layer = layerValues({ form: profile.form, bindings: profile.bindings, formatter, format: profile.format })
  let values: ReturnType<typeof layer.of>
  try {
    values = layer.of(data, requestExpressions(undefined, expressions))
  } catch (error) {
    const failure = failureOf(profile.form, error, [])
    if (failure) return [failure]
    throw error
  }
  const failures: PdfPrintFailure[] = []
  for (const bound of layer.bound) {
    const field = profile.fields.get(bound.field)
    try {
      const value = bound.value(values)
      if (!field || field.type === 'other' || value === null || value === undefined) continue
      const assigned = assignedValue(field.type, value)
      const drawn = field.type === 'text' ? undefined : choiceDrawing(field.flags, field.options, assigned).drawn
      const text = drawn ? drawn.text : String(assigned)
      const layouts = drawn ? field.widgets.map((layout) => layout(drawn)) : field.textLayouts
      for (const layout of layouts) {
        layoutFieldText(layout, text, measureRuns(field.name, text, profile.faces))
      }
    } catch (error) {
      const failure = failureOf(profile.form, error, bound.paths, bound.field)
      if (!failure) throw error
      failures.push(failure)
    }
  }
  return failures
}
