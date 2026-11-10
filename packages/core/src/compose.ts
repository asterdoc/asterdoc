/**
 * `@asterdoc/core/compose`: the part of core a document composition needs at
 * runtime, such as `@asterdoc/react` in a browser. It evaluates an artifact's
 * computed definitions and gives the rules flow-positioned signing fields
 * print. It carries none of core's validation, rendering, sealing or lookup
 * data, so a bundle that imports only this entry stays small.
 *
 * @packageDocumentation
 */

export { evaluateFormDefs } from './logic/runtime/evaluation/form-evaluator'
export type { FormDataPayload } from './logic/runtime/evaluation/context-builder'
export type {
  AnnexRuntimeState,
  EvaluationIssue,
  FieldRuntimeState,
  FormEvaluationResult,
  FormRuntimeState,
} from './logic/runtime/evaluation/types'
export { INITIALS_RULE, SIGNATURE_RULE } from './artifacts/form/signing-rules'
