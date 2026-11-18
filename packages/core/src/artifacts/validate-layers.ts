/**
 * `validateLayers()`: an artifact checked with the files it refers to. It sits
 * above the form runtime, which it uses to render each test of a form, so
 * the validation modules the runtime depends on never import the runtime.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Form, Resolver } from '@asterdoc/types'
import { PdfBindingKeyError } from '@asterdoc/render'
import { validateFileTemplates } from '@/logic/design-time/validation/validate-templates'
import { hasTemplateLayers, validate } from '@/validation/artifact'
import { validateFileReferences } from '@/validation/file-references'
import { validatePdfLayers, type LayerValidationIssue } from '@/validation/pdf-layers'
import { validatePlaceFormats } from '@/validation/place-definitions'
import { validateValueFormats } from '@/validation/value-formats'
import type { ValidateOptions } from '@/types'
import { loadFormEachLayer } from './form/form'
import { testDrafts } from './form/form-tests'

type LayerLoad = Awaited<ReturnType<typeof loadFormEachLayer>>

function testValueIssues(form: Form, loaded: LayerLoad): LayerValidationIssue[] {
  const tests = form.tests ?? []
  if (tests.length === 0) return []
  const layers = loaded.layers
  const draftOf = testDrafts(loaded.instance)
  const issues: LayerValidationIssue[] = []
  for (const test of tests) {
    const reported = new Set<string>()
    const draft = draftOf(test)
    if (!draft.success || !draft.data.isValid()) continue
    const problems = layers.flatMap((layer) => draft.data.renderProblems(layer))
    for (const error of problems) {
      if (error.layer === undefined) continue
      const once = `${error.layer}\u0000${error.field}`
      if (reported.has(once)) continue
      reported.add(once)
      issues.push({
        message: `Layer "${error.layer}", test "${test.name}": a render of the values of this test fails. ${error.message.replace(/^Layer "[^"]*": /, '')}`,
        path: error.pdfField ? ['layers', error.layer, 'bindings', error.pdfField] : ['layers', error.layer],
        severity: 'error',
      })
    }
  }
  return issues
}

function issuePath(field: string): string[] {
  return field.split(/[.[\]]+/).filter((segment) => segment.length > 0)
}

function noValueIssues(loaded: LayerLoad): LayerValidationIssue[] {
  const layers = loaded.layers
  if (layers.length === 0) return []
  const draft = loaded.instance.safeFill({} as never)
  if (!draft.success) {
    return [{ message: `The form with no values given could not be filled: ${draft.error.message}`, path: ['fields'], severity: 'error' }]
  }
  return layers.flatMap((layer) => draft.data.renderProblems(layer).map((error): LayerValidationIssue => ({
    message: `Layer "${layer}", with no values given: ${error.message.replace(/^Layer "[^"]*": /, '')}`,
    path: issuePath(error.field),
    severity: 'error',
  })))
}

type ReportedIssue = { path?: ReadonlyArray<unknown>; severity?: string }

function sameCause(issue: ReportedIssue, layer: string, error: Error): boolean {
  const path = issue.path ?? []
  if ((issue.severity ?? 'error') !== 'error' || path[0] !== 'layers' || path[1] !== layer) return false
  if (path.length === 2) return true
  return error instanceof PdfBindingKeyError && (path[2] === 'bindings' || path[2] === 'bindingsFrom')
}

function unreadLayerIssues(loaded: LayerLoad, reported: readonly ReportedIssue[]): LayerValidationIssue[] {
  return [...loaded.failures].flatMap(([layer, error]): LayerValidationIssue[] => {
    if (reported.some((issue) => sameCause(issue, layer, error))) return []
    return [{ message: `Layer "${layer}" cannot be read for the render check: ${error.message}`, path: ['layers', layer], severity: 'error' }]
  })
}

/** Options for {@link validateLayers}. */
export interface ValidateLayersOptions extends ValidateOptions {
  /** Reads file-backed layers, relative to the artifact. */
  resolver: Resolver
}

/**
 * The result of {@link validateLayers}: a Standard Schema result, whose issues
 * are the errors, and the warnings found alongside them. Warnings do not fail
 * validation.
 */
export type ValidateLayersResult<T> = StandardSchemaV1.Result<T> & {
  readonly warnings?: readonly LayerValidationIssue[]
}

/** A resolver that reads each path once, so the checks that share a file share one read. */
function readOnce(resolver: Resolver): Resolver {
  const reads = new Map<string, Promise<Uint8Array>>()
  return {
    read(path) {
      let read = reads.get(path)
      if (!read) {
        read = resolver.read(path)
        reads.set(path, read)
      }
      return read
    },
  }
}

/**
 * Validate an artifact and the files it refers to. `validate()` checks inline
 * layers; this also reads each file through the resolver, and a file that
 * cannot be read is an error:
 * - every file-backed layer except a React layer, whose path names a module;
 * - the `instructions` and `agentInstructions` files;
 * - the template expressions of each text and DOCX layer, and that each text
 *   template places its 'flow' signature slots;
 * - for a form, that every key of a PDF layer's bindings is an AcroForm field
 *   of its template, and that every value a binding accepts can fill its PDF
 *   text field: it fits the box at the minimum font size, and has no more
 *   characters than a comb field has boxes. A bound text field with nothing
 *   bounding its length is a warning;
 * - for a form, that each PDF layer prints the values of each test in `tests`
 *   whose data is valid, as the render check of the test's draft reports
 *   them: no overflow, comb, mask or font problem. A test whose data is not
 *   valid shows an unhappy path and is not rendered;
 * - for a form, the render check of each PDF layer on the form with no values
 *   given, holding every default that applies then, and every constant text
 *   a layer prints. A layer that cannot be read for it is an error;
 * - for a form, that a stored value a layer prints with a country or region
 *   format normalizes; a default that does not is a warning.
 * - for a form, a warning for each layer or PDF binding that prints person
 *   names family-first, since a person given only a name cannot be reordered.
 *
 * @example
 * ```typescript
 * const result = await validateLayers(form, { resolver: createFsResolver({ root: '.' }) })
 * for (const warning of result.warnings ?? []) console.warn(warning.message)
 * ```
 */
export async function validateLayers<T = unknown>(
  input: unknown,
  options: ValidateLayersOptions,
): Promise<ValidateLayersResult<T>> {
  const { resolver, ...validateOptions } = options
  const result = validate<T>(input, validateOptions)
  if (result.issues) return result
  const artifact: unknown = result.value
  const reader = readOnce(resolver)
  const fileIssues = await validateFileReferences(artifact, reader)
  const templateIssues = validateOptions.logic === false || !hasTemplateLayers(artifact) ? [] : await validateFileTemplates(artifact, reader)
  const isForm = hasTemplateLayers(artifact) && artifact.kind === 'form'
  const pdfLayers = isForm ? await validatePdfLayers(artifact as unknown as Form, reader) : { issues: [], checked: [] }
  const loaded = isForm ? await loadFormEachLayer(artifact as unknown as Form, { resolver: reader }) : undefined
  const unread = loaded ? unreadLayerIssues(loaded, [...fileIssues, ...pdfLayers.issues]) : []
  const testFonts = loaded ? testValueIssues(artifact as unknown as Form, loaded) : []
  const defaults = loaded ? noValueIssues(loaded) : []
  const pdf = [...pdfLayers.issues, ...unread, ...testFonts, ...defaults]
  const errors = [...fileIssues, ...templateIssues, ...pdf.filter((issue) => issue.severity === 'error')]
  const places = hasTemplateLayers(artifact) && artifact.kind === 'form' ? validatePlaceFormats(artifact as unknown as Form) : []
  const formats = hasTemplateLayers(artifact) && artifact.kind === 'form' ? validateValueFormats(artifact as unknown as Form) : []
  const warnings = [...pdf.filter((issue) => issue.severity === 'warning'), ...places, ...formats]
  const outcome: StandardSchemaV1.Result<T> = errors.length > 0 ? { issues: errors } : result
  return warnings.length > 0 ? { ...outcome, warnings } : outcome
}
