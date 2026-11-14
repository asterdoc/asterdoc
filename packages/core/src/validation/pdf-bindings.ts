/**
 * Authoring check of a form's PDF layer bindings against the form.
 *
 * A PDF layer's `bindings` map AcroForm field names (keys) to Asterdoc paths
 * (values). Rendering refuses a value it cannot parse or that names no path
 * the form declares, so `validate()` reports each one first. An inverted binding, with a field
 * name in the value position, is the common case. A binding object's format or
 * part where it cannot apply, such as on an option test, is reported too. A
 * template binding is checked as a text layer's template is: every expression
 * and format modifier, against the form's type environment.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'
import { isPdfMimeType } from '@asterdoc/schemas'
import type { BindingValue, Form } from '@asterdoc/types'
import { parseMask } from '@asterdoc/format'
import { bindingFormatProblem, bindingPartProblem, fieldDefinition, parseBinding, PdfBindingSyntaxError, splitPartIndex, type ParsedPdfBinding } from '@asterdoc/render'
import { ArtifactFieldFormatError, checkTextTemplate, formValueResolver, validateFieldBindings, type TemplateCheckOptions, type TemplateDiagnostic } from '@asterdoc/render/text'
import type { TypeEnv } from '@asterdoc/expr'
import { buildTemplateTypeEnvironment, type TemplateArtifact } from '@/logic/design-time/validation/validate-templates'

interface TemplateChecks {
  env(): TypeEnv
  options: TemplateCheckOptions
}

function templateChecks(form: Form): TemplateChecks {
  let env: TypeEnv | undefined
  return {
    env: () => env ??= buildTemplateTypeEnvironment(form as unknown as TemplateArtifact),
    options: { values: formValueResolver(form) },
  }
}

function templateProblem(diagnostic: TemplateDiagnostic): string {
  const where = diagnostic.position ? ` at line ${diagnostic.position.line}, column ${diagnostic.position.column}` : ''
  const expression = diagnostic.expression === undefined ? '' : ` in {{${diagnostic.expression}}}`
  return `Template error${where}${expression}: ${diagnostic.message.replace(/\.$/, '')}`
}

function bindingProblems(form: Form, bindingKey: string, value: BindingValue, checks: TemplateChecks): string[] {
  let parsed: ParsedPdfBinding
  try {
    parsed = parseBinding(value)
  } catch (error) {
    if (!(error instanceof PdfBindingSyntaxError)) throw error
    return [error.message.replace(/\.$/, '')]
  }
  if (parsed.template) return checkTextTemplate(parsed.template.source, checks.env(), checks.options).map(templateProblem)
  for (const { source } of parsed.parts) {
    try {
      validateFieldBindings(form, { [bindingKey]: source })
    } catch (error) {
      if (!(error instanceof ArtifactFieldFormatError)) throw error
      const detail = (error.issues[0]?.message ?? error.message).replace(/\.$/, '')
      return [`"${source}" is not a known Asterdoc path (${detail})`]
    }
  }
  const problem = bindingFormatProblem(form, parsed) ?? bindingPartProblem(form, parsed)
  const found = problem ? `Binding ${JSON.stringify(parsed.path)} ${problem}` : maskGroupProblem(form, parsed)
  return found ? [found] : []
}

function maskGroupProblem(form: Form, parsed: ParsedPdfBinding): string | undefined {
  for (const part of parsed.parts) {
    const index = part.qualifier === undefined ? undefined : splitPartIndex(part.qualifier)
    const field = index === undefined ? undefined : fieldDefinition(form, part.path)
    if (index === undefined || field?.type !== 'text' || field.mask === undefined) continue
    const groups = parseMask(field.mask).groups.length
    if (index >= groups) return `"${part.source}:${part.qualifier}" names group ${index + 1}, but the mask ${field.mask} has ${groups} group${groups === 1 ? '' : 's'}`
  }
  return undefined
}

/**
 * Check that every value of every PDF layer's own `bindings` parses, names
 * only Asterdoc paths the form declares, sets no format or part where it
 * cannot apply, and, for a template, holds only expressions and format
 * modifiers that check against the form.
 * A layer reusing bindings through `bindingsFrom` is checked where the
 * bindings are declared.
 */
export function validatePdfBindingPaths(form: Form): StandardSchemaV1.Issue[] {
  const issues: StandardSchemaV1.Issue[] = []
  const checks = templateChecks(form)
  for (const [layerKey, layer] of Object.entries(form.layers ?? {})) {
    if (layer.kind !== 'file' || !isPdfMimeType(layer.mimeType) || !layer.bindings) continue
    for (const [bindingKey, value] of Object.entries(layer.bindings)) {
      const inverted = Object.hasOwn(form.fields ?? {}, bindingKey)
        ? ` The key "${bindingKey}" is a field of this artifact: bindings map AcroForm field names (keys) to Asterdoc paths (values).`
        : ''
      for (const problem of bindingProblems(form, bindingKey, value, checks)) {
        issues.push({ message: `Layer "${layerKey}", binding "${bindingKey}": ${problem}.${inverted}`, path: ['layers', layerKey, 'bindings', bindingKey] })
      }
    }
  }
  return issues
}
