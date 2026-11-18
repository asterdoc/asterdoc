/**
 * `validateLayers()`: an artifact checked with the files it refers to. It sits
 * above the form runtime, which it uses to render each test of a form, so
 * the validation modules the runtime depends on never import the runtime.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Form, Resolver } from '@asterdoc/types'
import { validateFileTemplates } from '@/logic/design-time/validation/validate-templates'
import { hasTemplateLayers, validate } from '@/validation/artifact'
import { validateFileReferences } from '@/validation/file-references'
import { validatePdfLayers, type LayerValidationIssue } from '@/validation/pdf-layers'
import { validatePlaceFormats } from '@/validation/place-definitions'
import { validateValueFormats } from '@/validation/value-formats'
import type { ValidateOptions } from '@/types'
import { form as formApi } from './form/form'
import { testDrafts } from './form/form-tests'

async function testValueIssues(form: Form, options: { resolver: Resolver }): Promise<LayerValidationIssue[]> {
  const tests = form.tests ?? []
  if (tests.length === 0) return []
  const loaded = await formApi.safeLoad(form, options)
  if (!loaded.success) return []
  const draftOf = testDrafts(loaded.data)
  const issues: LayerValidationIssue[] = []
  for (const test of tests) {
    const reported = new Set<string>()
    const draft = draftOf(test)
    if (!draft.success || !draft.data.isValid()) continue
    const problems = Object.keys(form.layers ?? {}).flatMap((layer) => draft.data.renderProblems(layer))
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

function defaultPath(field: string): string[] {
  const [root, ...rest] = field.split('.')
  if (root !== 'fields' || rest.length === 0 || rest.some((segment) => /^\d+$/.test(segment))) return []
  return ['fields', ...rest.flatMap((segment, index) => (index === 0 ? [segment] : ['fields', segment])), 'default']
}

function emptyFieldsets(fields: Form['fields']): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields ?? {})) {
    if (field.type === 'fieldset') values[key] = emptyFieldsets(field.fields)
  }
  return values
}

async function defaultValueIssues(form: Form, options: { resolver: Resolver }, layers: readonly string[]): Promise<LayerValidationIssue[]> {
  const loaded = await formApi.safeLoad(form, options)
  if (!loaded.success) return []
  const withFieldsets = loaded.data.safeFill({ fields: emptyFieldsets(form.fields) } as never)
  const draft = withFieldsets.success ? withFieldsets : loaded.data.safeFill({ fields: {} } as never)
  if (!draft.success) return []
  return layers.flatMap((layer) => draft.data.renderProblems(layer).map((error): LayerValidationIssue => {
    const path = defaultPath(error.field)
    return {
      message: `Layer "${layer}", the default of ${error.field}: the layer cannot print it. ${error.message.replace(/^Layer "[^"]*": /, '')}`,
      path: path.length > 0 ? path : ['layers', layer],
      severity: 'error',
    }
  }))
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
 * - for a form, that each PDF layer can print the defaults of its fields, as
 *   a render of a form with no values given prints them;
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
  const testFonts = isForm && pdfLayers.checked.length > 0 ? await testValueIssues(artifact as unknown as Form, { resolver: reader }) : []
  const defaults = isForm && pdfLayers.checked.length > 0 ? await defaultValueIssues(artifact as unknown as Form, { resolver: reader }, pdfLayers.checked) : []
  const pdf = [...pdfLayers.issues, ...testFonts, ...defaults]
  const errors = [...fileIssues, ...templateIssues, ...pdf.filter((issue) => issue.severity === 'error')]
  const places = hasTemplateLayers(artifact) && artifact.kind === 'form' ? validatePlaceFormats(artifact as unknown as Form) : []
  const formats = hasTemplateLayers(artifact) && artifact.kind === 'form' ? validateValueFormats(artifact as unknown as Form) : []
  const warnings = [...pdf.filter((issue) => issue.severity === 'warning'), ...places, ...formats]
  const outcome: StandardSchemaV1.Result<T> = errors.length > 0 ? { issues: errors } : result
  return warnings.length > 0 ? { ...outcome, warnings } : outcome
}
