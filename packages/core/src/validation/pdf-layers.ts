/**
 * Authoring check that a form's PDF layers can be filled.
 *
 * Filling misses a binding whose key is not an AcroForm field of the template,
 * and fails when a value cannot fit its PDF text field at the minimum font
 * size, or has more characters than a comb field has boxes. `validateLayers()`
 * runs these checks on each file-backed PDF layer of a form, so an artifact
 * whose declarations allow such a value is reported before any data is filled.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Bindings, FileLayer, Form, Resolver } from '@asterdoc/types'
import { isPdfMimeType } from '@asterdoc/schemas'
import { parseBinding, PdfBindingSyntaxError, resolveLayerBindings } from '@asterdoc/render'
import { checkPdfBindingFit, findPdfLabelCollisions, inspectAcroFormFields, pdfFontCheck, type PdfBindingFitIssue, type PdfFieldFillError, type PdfFieldInfo } from '@asterdoc/render/pdf'
import { form as formApi } from '@/artifacts/form/form'
import { testDrafts } from '@/artifacts/form/form-tests'

/** A validation issue with the severity the validation model gives it. */
export interface LayerValidationIssue extends StandardSchemaV1.Issue {
  readonly severity: 'error' | 'warning'
}

function issueFor(key: string, issue: PdfBindingFitIssue): LayerValidationIssue {
  return {
    message: `Layer "${key}", PDF field "${issue.field}" (bound to ${issue.paths.join(', ')}): ${issue.message}`,
    path: ['layers', key, 'bindings', issue.field],
    severity: issue.severity,
  }
}

function readFailure(key: string, what: string, path: string, error: unknown): LayerValidationIssue {
  return {
    message: `Layer "${key}" ${what} could not be read from "${path}": ${error instanceof Error ? error.message : String(error)}`,
    path: ['layers', key],
    severity: 'error',
  }
}

/**
 * Each binding key that names no AcroForm field of the layer's template. A key
 * the layer reuses through `bindingsFrom` is reported at its `bindingsFrom`.
 */
function unknownBindingKeys(layerKey: string, layer: FileLayer, fields: readonly PdfFieldInfo[], bindings: Bindings): LayerValidationIssue[] {
  const names = fields.map((field) => field.name)
  const known = new Set(names)
  const available = names.length > 0 ? `Its fields are: ${names.join(', ')}.` : 'It has no AcroForm fields.'
  const reused = layer.bindings ? undefined : layer.bindingsFrom
  return Object.keys(bindings).filter((bindingKey) => !known.has(bindingKey)).map((bindingKey) => ({
    message: `Layer "${layerKey}", binding "${bindingKey}"${reused ? ` (from layer "${reused}")` : ''}: "${bindingKey}" is not an AcroForm field in "${layer.path}". ${available}`,
    path: reused ? ['layers', layerKey, 'bindingsFrom'] : ['layers', layerKey, 'bindings', bindingKey],
    severity: 'error',
  }))
}

function templateFieldIssues(layerKey: string, layer: FileLayer, fields: readonly PdfFieldInfo[], bindings: Bindings): LayerValidationIssue[] {
  const byName = new Map(fields.map((field) => [field.name, field]))
  const reused = layer.bindings ? undefined : layer.bindingsFrom
  const issues: LayerValidationIssue[] = []
  for (const [bindingKey, value] of Object.entries(bindings)) {
    const field = byName.get(bindingKey)
    if (!field) continue
    let template
    try {
      template = parseBinding(value).template
    } catch (error) {
      if (error instanceof PdfBindingSyntaxError) continue
      throw error
    }
    if (!template) continue
    const problem = field.type !== 'text'
      ? `a template fills a text field, and "${bindingKey}" is a ${field.type} field in "${layer.path}"`
      : template.lineBreak && !field.multiline
        ? `the template has a line break, and "${bindingKey}" is a single-line field in "${layer.path}", which prints it as a space; a line break starts a new line only in a multi-line field`
        : undefined
    if (!problem) continue
    issues.push({
      message: `Layer "${layerKey}", binding "${bindingKey}"${reused ? ` (from layer "${reused}")` : ''}: ${problem}.`,
      path: reused ? ['layers', layerKey, 'bindingsFrom'] : ['layers', layerKey, 'bindings', bindingKey],
      severity: 'error',
    })
  }
  return issues
}

function refusedOnce(refused: readonly PdfFieldFillError[]): PdfFieldFillError[] {
  const reported: PdfFieldFillError[] = []
  for (const error of refused) {
    const paths = error.paths ?? []
    const repeats = reported.some((earlier) => {
      const known = earlier.paths ?? []
      const samePaths = known.length === paths.length && known.every((path) => paths.includes(path))
      const sameCause = earlier.character === error.character && earlier.script === error.script && known.every((path) => paths.includes(path))
      return samePaths || (known.length > 0 && sameCause)
    })
    if (!repeats) reported.push(error)
  }
  return reported
}

async function testValueFontIssues(form: Form, resolver: Resolver, layerKeys: readonly string[]): Promise<LayerValidationIssue[]> {
  const tests = form.tests ?? []
  if (tests.length === 0 || layerKeys.length === 0) return []
  const draftOf = testDrafts(formApi.from(form, { resolver }))
  const checks = new Map(layerKeys.map((key) => [key, pdfFontCheck()]))
  const issues: LayerValidationIssue[] = []
  for (const test of tests) {
    const draft = draftOf(test)
    if (!draft.success) continue
    for (const [key, renderer] of checks) {
      let refused: PdfFieldFillError[]
      try {
        refused = await draft.data.render({ layer: key, renderer })
      } catch {
        checks.delete(key)
        continue
      }
      issues.push(...refusedOnce(refused).map((error) => ({
        message: `Layer "${key}", test "${test.name}": a render of the values of this test fails. ${error.message}`,
        path: ['layers', key, 'bindings', error.field],
        severity: 'error' as const,
      })))
    }
  }
  return issues
}

/**
 * Check every file-backed PDF layer of a form: each binding key must name an
 * AcroForm field of the template, a template binding must fill a text field
 * and break lines only in a multi-line one, and each binding to a text field
 * must fit its box for every value the bound field accepts, as the layer's
 * format prints it. An unknown key, a template its field cannot print, and a
 * value that cannot fit are errors; a text
 * field with no length bound, and labels the format prints that reading the
 * PDF back cannot tell apart, are warnings.
 * Each test of the form is then rendered without drawing: a value of a test
 * that the fonts of the layer cannot draw is an error naming the layer, the
 * test, the PDF field and the artifact path.
 * A template that cannot be read is skipped: `validateFileReferences` reports it.
 */
export async function validatePdfLayers(form: Form, resolver: Resolver): Promise<LayerValidationIssue[]> {
  const layers = form.layers ?? {}
  const issues: LayerValidationIssue[] = []
  const checked: string[] = []
  for (const [key, layer] of Object.entries(layers)) {
    if (layer.kind !== 'file' || !isPdfMimeType(layer.mimeType)) continue
    const fileLayer = layer as FileLayer
    const { font } = fileLayer
    let template: Uint8Array
    try {
      template = await resolver.read(fileLayer.path)
    } catch {
      continue
    }
    let layerFont: { bytes: Uint8Array; source: string } | undefined
    if (font) {
      try {
        layerFont = { bytes: await resolver.read(font.path), source: font.path }
      } catch (error) {
        issues.push(readFailure(key, 'font', font.path, error))
        continue
      }
    }
    try {
      const bindings = resolveLayerBindings(layers, layer)
      if (bindings) {
        const fields = await inspectAcroFormFields(template, { includeButton: true, includeSignature: true })
        issues.push(...unknownBindingKeys(key, fileLayer, fields, bindings), ...templateFieldIssues(key, fileLayer, fields, bindings))
      }
      const found = await checkPdfBindingFit({ template, form, bindings, ...(layerFont && { layerFont }), ...(fileLayer.format && { format: fileLayer.format }) })
      issues.push(...found.map((issue) => issueFor(key, issue)))
      issues.push(...findPdfLabelCollisions({ form, bindings, ...(fileLayer.format && { format: fileLayer.format }) }).map((collision) => ({
        message: `Layer "${key}", PDF field "${collision.field}": ${collision.message}`,
        path: bindings ? ['layers', key, 'bindings', collision.field] : ['layers', key, 'format'],
        severity: 'warning' as const,
      })))
      checked.push(key)
    } catch (error) {
      issues.push({
        message: `Layer "${key}" could not be checked: ${error instanceof Error ? error.message : String(error)}`,
        path: ['layers', key],
        severity: 'error',
      })
    }
  }
  issues.push(...await testValueFontIssues(form, resolver, checked))
  return issues
}
