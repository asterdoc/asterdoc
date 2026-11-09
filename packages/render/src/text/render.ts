import { defaultFormatter } from '@asterdoc/format'
import type { Form, Formatter, LayerFormat } from '@asterdoc/types'
import { formatFieldData, type FieldFormattingOptions } from './field-formatter'
import { createTextSignatureDirectives, type TextSignatureOptions } from './signatures'
import { escapeHtml, renderTemplate } from './template'
import { templateData, type TemplateExpressionOptions } from '../template/context'
import { formatFieldOptions, formatterFor } from '../presentation'

export interface RenderTextOptions {
  template: string
  data: Record<string, unknown>
  form?: Form
  formatter?: Formatter
  progressive?: FieldFormattingOptions['progressive']
  signatureOptions?: TextSignatureOptions
  /** The expression context and configured functions templates read. */
  expressions?: TemplateExpressionOptions
  /** The layer key, named in template errors. */
  layer?: string
  /**
   * The output MIME type. `text/html` escapes interpolated values; plain text
   * and Markdown print them unchanged.
   */
  mimeType?: string
  /** How the layer prints values, applied over `formatter`. */
  format?: LayerFormat
}

/** The escaper for a text layer's output format: only HTML output escapes values. */
function escapeFor(mimeType: string | undefined): (value: string) => string {
  return mimeType?.toLowerCase() === 'text/html' ? escapeHtml : (value) => value
}

export function renderText(options: RenderTextOptions): string {
  const formatter = formatterFor(options.formatter ?? defaultFormatter, options.format)
  const progressive: FieldFormattingOptions | undefined = options.progressive === undefined
    ? undefined
    : { progressive: options.progressive }
  const formattingOptions = options.format ? formatFieldOptions(options.format, progressive) : progressive
  const data = options.form
    ? formatFieldData(options.data, options.form, formatter, formattingOptions)
    : options.data
  const { context, resolveData } = templateData(options.data, data, options.form, options.expressions)
  return renderTemplate(options.template, {
    context,
    resolveData,
    root: data,
    formatter,
    directives: createTextSignatureDirectives(options.signatureOptions, options.mimeType),
    layer: options.layer,
    escape: escapeFor(options.mimeType),
  })
}
