import type { AsterdocRenderer, RendererLayer, RenderRequest } from '@asterdoc/types'
import { acroFields, drawnFieldText, fieldFontNames, type AcroField } from './acroform'
import { PdfFontSet } from './drawing-fonts'
import { PdfFieldFillError } from './field-appearance'
import { assignedValue, layerValues, type RenderPdfOptions } from './render'
import { requestPdfOptions, type PdfRendererOptions } from './renderer'
import { PdfModel } from './syntax'

type LayerOptions = Omit<RenderPdfOptions, 'data' | 'expressions' | 'overlays'>
type RequestCheck = (data: RenderPdfOptions['data'], expressions: RenderPdfOptions['expressions']) => PdfFieldFillError[]

async function layerCheck({ template, form, bindings, formatter, font, layerFont, format }: LayerOptions): Promise<RequestCheck> {
  const model = await PdfModel.load(template)
  const acro = acroFields(model)
  if (!acro) return () => []
  const fonts = PdfFontSet.create(model, { font, layerFont })
  await fonts.readFormFonts(model.dict(acro.acroForm.entries.get('DR')))
  const layer = layerValues({ form, bindings, formatter, format })
  const byName = new Map(acro.fields.map((field) => [field.name, field]))
  const printed = layer.bound.flatMap((bound) => {
    const field = byName.get(bound.field)
    const fontNames = field ? fieldFontNames(model, field) : []
    return field && fontNames.length > 0 ? [{ bound, field, fontNames }] : []
  })
  const drawable = new Set<string>()
  const refusal = (field: AcroField, text: string, fontNames: ReadonlyArray<string | undefined>): PdfFieldFillError | undefined => {
    for (const fontName of fontNames) {
      const key = `${fontName ?? ''}\u0000${text}`
      if (drawable.has(key)) continue
      try {
        fonts.select(field.name, text, fontName)
        drawable.add(key)
      } catch (error) {
        if (error instanceof PdfFieldFillError) return error
        throw error
      }
    }
    return undefined
  }
  return (data, expressions) => {
    const refused: PdfFieldFillError[] = []
    let values: ReturnType<typeof layer.of>
    try {
      values = layer.of(data, expressions)
    } catch {
      return refused
    }
    for (const { bound, field, fontNames } of printed) {
      let text: string | undefined
      try {
        const value = bound.value(values)
        if (value === null || value === undefined) continue
        text = drawnFieldText(model, field, assignedValue(field, value))
      } catch {
        continue
      }
      const error = text === undefined ? undefined : refusal(field, text, fontNames)
      if (error) refused.push(error.withPaths(bound.paths))
    }
    return refused
  }
}

/**
 * A renderer that draws nothing. For each render request it returns the
 * {@link PdfFieldFillError} a PDF render of that request would throw for each
 * bound field whose text no font can draw: a `missing-glyph` or an
 * `unsupported-script` error that names the PDF field and the artifact paths
 * it prints. A request with only drawable text gives an empty list.
 *
 * The values, the formats and the fonts are those of {@link pdfRenderer}, read
 * by the same code. A value that cannot be printed for another reason, such as
 * one that does not fit its box, is not reported. The PDF is read once for
 * consecutive requests that carry the same layer, so one checker can take
 * many sets of data for one layer at little cost.
 *
 * @throws {PdfFontError} when a font of the request cannot be used.
 */
export function pdfFontCheck(options: PdfRendererOptions = {}): AsterdocRenderer<RendererLayer, PdfFieldFillError[]> {
  let last: { layer: readonly unknown[]; check: Promise<RequestCheck> } | undefined
  return {
    id: 'pdf-font-check',
    async render(request: RenderRequest<RendererLayer>) {
      const { template } = request
      if (!(template.content instanceof Uint8Array)) {
        throw new TypeError('The PDF font check needs a PDF layer that carries its bytes.')
      }
      const { data, expressions, ...layer } = requestPdfOptions(request as RenderRequest<RendererLayer & { content: Uint8Array }>, options)
      const key = [template.content, template.font?.content, template.font?.path, layer.bindings, layer.format, layer.form, layer.formatter]
      if (!last || key.some((part, index) => part !== last!.layer[index])) last = { layer: key, check: layerCheck(layer) }
      return (await last.check)(data, expressions)
    },
  }
}
