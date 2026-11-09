import type { StandardSchemaV1 } from '@standard-schema/spec'
import { canonicalizeMasked } from '@asterdoc/format'
import { fieldDefinition, mergeFormats, parseBinding, PdfBindingSyntaxError, resolveLayerBindings } from '@asterdoc/render'
import type { Form, FormField, ValueFormat } from '@asterdoc/types'
import type { LayerValidationIssue } from './pdf-layers'

function maskDefaultIssues(fields: Record<string, FormField>, path: string[]): StandardSchemaV1.Issue[] {
  return Object.entries(fields).flatMap(([key, field]): StandardSchemaV1.Issue[] => {
    const at = [...path, key]
    if (field.type === 'fieldset') return maskDefaultIssues(field.fields, [...at, 'fields'])
    if (field.type === 'list') return maskDefaultIssues({ item: field.item as FormField }, at)
    if (field.type !== 'text' || field.mask === undefined || field.default === undefined) return []
    const read = canonicalizeMasked(field.mask, field.default)
    return read.success ? [] : [{ message: `Field "${at.join('.')}" has a default that does not fit its mask: ${read.message}`, path: [...at, 'default'] }]
  })
}

/**
 * Each masked text field whose `default` does not fill its mask, written with
 * or without the mask's literals.
 */
export function validateMaskDefaults(form: Form): StandardSchemaV1.Issue[] {
  return maskDefaultIssues(form.fields ?? {}, ['fields'])
}

function readsPerson(form: Form, path: string): boolean {
  const [root] = path.split('.')
  if (root === 'parties') return true
  return fieldDefinition(form, path)?.type === 'person'
}

function hasPersonValues(form: Form): boolean {
  const visit = (field: FormField): boolean => field.type === 'person'
    || (field.type === 'list' && visit(field.item as FormField))
    || (field.type === 'fieldset' && Object.values(field.fields).some(visit))
  return Object.values(form.fields ?? {}).some(visit) || Object.values(form.parties ?? {}).some((party) => party.partyType !== 'organization')
}

const FAMILY_FIRST_LIMIT = 'a person given only a name prints the name as given, because it cannot be reordered; collect firstName and lastName to print it family-first'

function familyFirst(format: ValueFormat | undefined): boolean {
  return format?.person?.order === 'family-first'
}

/**
 * Warnings for value formats whose output depends on the data: a
 * `person.order: family-first` on a layer, or on a PDF binding that reads a
 * person, prints a person who has only `name` as given.
 */
export function validateValueFormats(form: Form): LayerValidationIssue[] {
  const layers = form.layers ?? {}
  const warnings: LayerValidationIssue[] = []
  for (const [key, layer] of Object.entries(layers)) {
    if (familyFirst(layer.format) && hasPersonValues(form)) {
      warnings.push({ message: `Layer "${key}" prints person names family-first, but ${FAMILY_FIRST_LIMIT}.`, path: ['layers', key, 'format', 'person', 'order'], severity: 'warning' })
      continue
    }
    let bindings
    try {
      bindings = layer.kind === 'file' ? resolveLayerBindings(layers, layer) : undefined
    } catch {
      continue
    }
    for (const [field, value] of Object.entries(bindings ?? {})) {
      let parsed
      try {
        parsed = parseBinding(value)
      } catch (error) {
        if (error instanceof PdfBindingSyntaxError) continue
        throw error
      }
      if (!familyFirst(mergeFormats(layer.format, parsed.format)) || !parsed.parts.some((part) => readsPerson(form, part.path))) continue
      warnings.push({ message: `Layer "${key}", binding "${field}" prints a person family-first, but ${FAMILY_FIRST_LIMIT}.`, path: ['layers', key, 'bindings', field], severity: 'warning' })
    }
  }
  return warnings
}
