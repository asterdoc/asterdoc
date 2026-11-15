import { defaultFormatter } from '../default-formatter'
import type {
  Formatter,
  AsterdocRenderer,
  RendererLayer,
  RenderRequest,
} from '@asterdoc/types'
import { requestRenderData } from '../render-data'
import type { PdfFont } from './drawing-fonts'
import { renderPdf, type RenderPdfOptions } from './render'
import { requestExpressions, type TemplateExpressionOptions } from '../template/context'

export interface PdfRendererOptions {
  formatter?: Formatter
  /**
   * A font supplied at render time, such as a licensed corporate font. It is
   * tried before the font the layer declares.
   */
  font?: PdfFont
  /** Configured functions binding templates can call when no artifact context is supplied. */
  expressions?: Pick<TemplateExpressionOptions, 'functions' | 'signatures'>
}

type PdfLayer = RendererLayer & { content: Uint8Array }

export function requestPdfOptions(request: RenderRequest<PdfLayer>, options: PdfRendererOptions): RenderPdfOptions {
  const { data, form } = requestRenderData(request)
  const { template } = request
  // What the layer declares travels with its template: its font, and the
  // presentation its template requires, applied over the caller's formatter.
  return {
    template: template.content,
    data,
    form,
    formatter: request.ctx?.formatter ?? options.formatter ?? defaultFormatter,
    bindings: template.bindings,
    expressions: requestExpressions(options.expressions, request.ctx?.expressions),
    font: options.font,
    layerFont: template.font && { bytes: template.font.content, source: template.font.path },
    ...(template.format && { format: template.format }),
  }
}

export function pdfRenderer(options: PdfRendererOptions = {}): AsterdocRenderer<PdfLayer & { type: 'pdf' }, Uint8Array> {
  return {
    id: 'pdf',
    render(request: RenderRequest<PdfLayer & { type: 'pdf' }>) {
      return renderPdf(requestPdfOptions(request, options))
    },
  }
}
