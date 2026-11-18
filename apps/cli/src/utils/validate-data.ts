/**
 * Validate a form data payload the way the SDK does: `(await form.load(definition)).fill(data).validate()`.
 *
 * `asterdoc data validate` and `asterdoc data fill` both use this, so the CLI
 * accepts and rejects exactly what the SDK accepts and rejects.
 */

import {
  FormValidationError,
  type DraftForm,
  type FillBatch,
  type FillBatchProblem,
  type Form,
  type FormInstance,
  type FormValidationResult,
  type ValidationError,
} from '@asterdoc/core'
import type { FormData } from '@asterdoc/types'

type RuleValidationResult = FormValidationResult['rules']['errors'][number]

/** The payload the SDK holds after a successful fill. */
export type FilledPayload = Pick<FormData, 'fields' | 'parties' | 'annexes'>

export type PayloadValidationResult =
  | { success: true; data: FilledPayload }
  | { success: false; errors: ValidationError[]; ruleErrors: RuleValidationResult[] }

type PayloadFailure = Extract<PayloadValidationResult, { success: false }>

/** The payload of a draft: complete or not, each value in it was accepted. */
export type DraftValidationResult =
  | { success: true; data: FilledPayload; open: string[] }
  | PayloadFailure

function fillFailure(error: Error): PayloadFailure {
  if (error instanceof FormValidationError) return { success: false, errors: error.errors, ruleErrors: [] }
  return { success: false, errors: [{ field: 'root', message: error.message }], ruleErrors: [] }
}

function filledPayload(draft: DraftForm<Form>): FilledPayload {
  return {
    fields: draft.fields,
    ...(Object.keys(draft.parties).length > 0 && { parties: draft.parties }),
    ...(Object.keys(draft.annexes).length > 0 && { annexes: draft.annexes }),
  }
}

/** The faults a fill batch finds in the values given: more values do not correct them. */
export function batchProblems(batch: FillBatch): FillBatchProblem[] {
  return [...batch.issues, ...batch.notApplicable, ...batch.unprintedNames]
}

/** Fill the loaded form with the payload and validate it, as the SDK does: whether the data matches the artifact. */
export function validateFormPayload(instance: FormInstance<Form>, payload: Record<string, unknown>): PayloadValidationResult {
  const filled = instance.safeFill(payload as never)
  if (!filled.success) return fillFailure(filled.error)

  const draft = filled.data
  const result = draft.validate()
  if (!result.valid) {
    return { success: false, errors: result.errors, ruleErrors: result.rules.errors }
  }

  return { success: true, data: filledPayload(draft) }
}

const TARGET_ROOTS = { field: 'fields', party: 'parties', annex: 'annexes' } as const

/**
 * Fill the form with a payload that may not be complete. A value the form
 * refuses and a fault in the values given fail as in `validateFormPayload`.
 * A required field, party or annex that is absent and a rule that is not met
 * do not: each is returned in `open`, as the line `validateFormPayload`
 * reports for it.
 */
export function validateDraftPayload(instance: FormInstance<Form>, payload: Record<string, unknown>): DraftValidationResult {
  const filled = instance.safeFill(payload as never)
  if (!filled.success) return fillFailure(filled.error)

  const draft = filled.data
  const batch = draft.getFillBatch()
  const problems = batchProblems(batch)
  if (problems.length > 0) {
    return { success: false, errors: problems.map((problem) => ({ field: problem.path || 'root', message: problem.message })), ruleErrors: [] }
  }

  const result = draft.validate()
  const openTargets = new Set(batch.open.filter((target) => target.required).map((target) => `${TARGET_ROOTS[target.kind]}.${target.key}`))
  const faults = result.errors.filter((error) => !openTargets.has(error.field))
  if (faults.length > 0) return { success: false, errors: faults, ruleErrors: [] }
  return { success: true, data: filledPayload(draft), open: result.valid ? [] : formatPayloadErrors(result.errors, result.rules.errors) }
}

/** Print validation errors and failed rules, one per line. */
export function printPayloadErrors(errors: ValidationError[], ruleErrors: RuleValidationResult[]): void {
  for (const line of formatPayloadErrors(errors, ruleErrors)) console.error(`  - ${line}`)
}

/** Format validation errors for command error messages. */
/** One line per value a layer cannot render: the path, then what fails, as the render check reports it. */
export function formatRenderProblems(problems: readonly ValidationError[]): string[] {
  return problems.map((problem) => `${problem.field}: ${problem.message.replace(/^Layer "[^"]*": /, '')}`)
}

export function formatPayloadErrors(
  errors: ValidationError[],
  ruleErrors: RuleValidationResult[]
): string[] {
  return [
    ...errors.map((error) => `${error.field || 'root'}: ${error.message}`),
    ...ruleErrors.map((rule) => `rules.${rule.ruleId}: ${rule.message ?? 'Rule failed'}`),
  ]
}
