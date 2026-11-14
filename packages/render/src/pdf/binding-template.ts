import type { Form, Formatter, LayerFormat, ValueFormat } from '@asterdoc/types'
import { templateSlotPart, type ParsedLayerBinding } from '../layer-bindings'
import { formatFieldOptions, formatterFor, mergeFormats } from '../presentation'
import { templateData, type TemplateData, type TemplateExpressionOptions } from '../template/context'
import { TemplateError } from '../template/errors'
import { TemplateScope } from '../template/scope'
import { formValueResolver } from '../template/values'
import { formatValueAt } from '../text/field-formatter'
import { renderTemplateNodes } from '../text/template'

const PDF_VALUE_DEFAULTS: ValueFormat = { choice: { display: 'value' } }

export interface BindingTemplatePrinterOptions {
  data: Record<string, unknown>
  form?: Form
  formatter: Formatter
  /** The layer's format, under each binding's own. */
  format?: LayerFormat
  /** The expression context and configured functions the templates read. */
  expressions?: TemplateExpressionOptions
}

function withoutCase(format: ValueFormat): ValueFormat {
  const { case: _case, ...rest } = format
  return rest
}

/**
 * The printer of one render's binding templates. It gives the text a template
 * binding fills its field with, or undefined when the field stays empty: the
 * template printed nothing, or every placeholder it reached printed nothing.
 *
 * A placeholder prints its value as a path binding to the same path prints
 * it. A binding's `case` applies to the whole text, the template's own
 * included.
 *
 * @throws {TemplateError} naming the field, when an expression fails.
 */
export function bindingTemplatePrinter({ data, form, formatter, format, expressions }: BindingTemplatePrinterOptions): (binding: ParsedLayerBinding) => string | undefined {
  let shared: TemplateData | undefined
  return ({ field, template, format: bindingFormat }) => {
    if (!template) return undefined
    const effective = mergeFormats<ValueFormat>(PDF_VALUE_DEFAULTS, format, bindingFormat)!
    const valueFormat = bindingFormat?.case === undefined ? effective : withoutCase(effective)
    const localized = formatterFor(formatter, valueFormat)
    const options = formatFieldOptions(valueFormat)
    shared ??= templateData(data, data, form, expressions)
    const { context, resolveRaw } = shared
    const resolveData = form
      ? (segments: readonly string[]) => formatValueAt(data, form, localized, templateSlotPart(segments)!.source, options)
      : shared.resolveData
    const scope = new TemplateScope(context, {
      formatter: localized,
      resolveData,
      resolveRaw,
      callerFormatter: formatter,
      format: valueFormat,
      ...(form && { values: formValueResolver(form) }),
    })
    let reached = 0
    let printed = 0
    let text: string
    try {
      text = renderTemplateNodes(template.nodes, scope, {
        context,
        resolveData,
        resolveRaw,
        root: data,
        formatter: localized,
        callerFormatter: formatter,
        format: valueFormat,
        escape: (value) => value,
        printed: (value) => {
          reached++
          if (value !== '') printed++
        },
      })
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error
      throw new TemplateError({ ...error.diagnostic, location: `binding "${field}"` })
    }
    if (text.trim() === '' || (reached > 0 && printed === 0)) return undefined
    return bindingFormat?.case === 'upper' ? text.toLocaleUpperCase(localized.locale) : text
  }
}
