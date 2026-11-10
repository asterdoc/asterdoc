/**
 * Rule Evaluator - evaluates form-level validation rules.
 *
 * Rules use @asterdoc/expr expressions with a flat context where:
 * - Field values are directly accessible: `ssn` instead of `fields.ssn`
 * - Defs values are accessible by name: `isIndividual`
 * - Everything else the form context carries is available: `fields.ssn`,
 *   `today()`, configured host functions, and the party predicates
 */

import type { Form, ValidationRule, RulesSection, RuleSeverity } from '@asterdoc/types'
import { evaluateGate } from './expression-evaluator'
import type { EvaluationContext } from './types'
import { parseExpression } from '../../design-time/validation/expression-parser'
import { formValuePrinter, readContextPath, redactingPrinter, type ValuePrinter } from '../../shared/sensitive-values'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of evaluating a single validation rule.
 */
export interface RuleValidationResult {
  /** Rule identifier */
  ruleId: string
  /** Whether the rule passed (expression evaluated to true) */
  passed: boolean
  /** Error message (only present if rule failed) */
  message?: string
  /** Severity level */
  severity: RuleSeverity
  /** The field paths the rule's failure attaches to, as the rule declares them. Absent, it is form level. */
  paths?: string[]
  /** For a failed rule: the values its expression reads. */
  explanation?: RuleExplanation
}

/** The values a failed rule's expression reads, each as printed. */
export interface RuleExplanation {
  /**
   * One entry per path the expression reads, in path order. A sensitive value
   * prints as `[redacted]` with its kind and length unless the caller asked
   * for raw values; a list prints at most ten elements.
   */
  values: RuleValueReport[]
}

/** One value a rule's expression reads. */
export interface RuleValueReport {
  /** The path as the expression writes it, such as `fields.ssn` or `isAdult`. */
  path: string
  /** The value as printed: JSON for a present value, `null` for a missing one. */
  value: string
}

/** How failed rules explain themselves. */
export interface RuleExplainOptions {
  /** Print sensitive values as they are. Never set it where the output is logged or shown to a model. */
  raw?: boolean
}

/** Options for rule evaluation. */
export interface RuleEvaluationOptions {
  /** How failed rules print the values they read; sensitive values are redacted by default. */
  explain?: RuleExplainOptions
}

/**
 * Result of evaluating all form validation rules.
 */
export interface FormRulesValidationResult {
  /** True if all error-severity rules passed (warnings don't block) */
  valid: boolean
  /** All rule results */
  rules: RuleValidationResult[]
  /** Failed rules with severity 'error' */
  errors: RuleValidationResult[]
  /** Failed rules with severity 'warning' */
  warnings: RuleValidationResult[]
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Builds a flat context for rule evaluation.
 *
 * Rules read everything the form's other expressions read, since the context
 * is the full form context: `fields`, `parties`, defs values, the clock, host
 * functions and their registry, the signing state, and row visibility. On top
 * of it, each field value is also readable by its bare id (`ssn` as well as
 * `fields.ssn`); a context root or defs key of the same name wins.
 *
 * @param fieldValues - Field values from the form (flat Record<string, unknown>)
 * @param defsValues - Evaluated defs section values
 * @param fullContext - Full evaluation context of the form
 * @returns Flat context for rule expression evaluation
 */
export function buildRuleContext(
  fieldValues: Record<string, unknown>,
  defsValues: Map<string, unknown>,
  fullContext: EvaluationContext
): EvaluationContext {
  // Object.assign copies the symbol-keyed settings and signing state too.
  return Object.assign({}, fieldValues, fullContext, Object.fromEntries(defsValues))
}

// ============================================================================
// Rule Evaluation
// ============================================================================

function failed(
  ruleId: string,
  rule: ValidationRule,
  message: string,
  values: RuleValueReport[],
): RuleValidationResult {
  return {
    ruleId,
    passed: false,
    message,
    severity: rule.severity ?? 'error',
    ...(rule.paths && { paths: [...rule.paths] }),
    explanation: { values },
  }
}

function evaluateWith(ruleId: string, rule: ValidationRule, context: EvaluationContext, printer: ValuePrinter): RuleValidationResult {
  const outcome = evaluateGate(rule.expr, context)
  if (outcome.status === 'value' && outcome.value) {
    return { ruleId, passed: true, severity: rule.severity ?? 'error', ...(rule.paths && { paths: [...rule.paths] }) }
  }
  const reads = parseExpression(rule.expr).variables
  const record = context as Record<string, unknown>
  const values = reads.map((path) => ({ path, value: printer.print(path, readContextPath(record, path)) }))
  if (outcome.status !== 'failed') return failed(ruleId, rule, rule.message, values)
  const message = printer.reveals(rule.expr)
    ? 'Rule expression error'
    : `Rule expression error: ${outcome.error}`
  return failed(ruleId, rule, message, values)
}

/**
 * Evaluates a single validation rule. A rule over inputs with no value yet
 * fails with its own message, the same as a comparison against an unanswered
 * field. A failed rule explains the values it read; with no form to say which
 * are sensitive, every value is redacted unless `explain.raw` is set.
 *
 * @param ruleId - Rule identifier
 * @param rule - The validation rule to evaluate
 * @param context - Flat context for expression evaluation
 * @param options - How a failure prints the values it read
 * @returns RuleValidationResult
 */
export function evaluateRule(
  ruleId: string,
  rule: ValidationRule,
  context: EvaluationContext,
  options: RuleEvaluationOptions = {}
): RuleValidationResult {
  return evaluateWith(ruleId, rule, context, redactingPrinter(options.explain))
}

function evaluateAll(
  rules: RulesSection | undefined,
  fieldValues: Record<string, unknown>,
  defsValues: Map<string, unknown>,
  fullContext: EvaluationContext,
  printerFor: (context: EvaluationContext) => ValuePrinter
): FormRulesValidationResult {
  if (!rules || Object.keys(rules).length === 0) {
    return { valid: true, rules: [], errors: [], warnings: [] }
  }
  const context = buildRuleContext(fieldValues, defsValues, fullContext)
  const printer = printerFor(fullContext)
  const results = Object.entries(rules).map(([ruleId, rule]) => evaluateWith(ruleId, rule, context, printer))
  const errors = results.filter((r) => !r.passed && r.severity === 'error')
  const warnings = results.filter((r) => !r.passed && r.severity === 'warning')
  return { valid: errors.length === 0, rules: results, errors, warnings }
}

/**
 * Evaluates all validation rules for a form. With no form to say which values
 * are sensitive, a failed rule's explanation redacts every value unless
 * `explain.raw` is set; {@link evaluateFormRules} knows the form's fields.
 *
 * @param rules - Rules section from the form definition
 * @param fieldValues - Field values (flat Record<string, unknown>)
 * @param defsValues - Evaluated defs section values
 * @param fullContext - Full evaluation context of the form
 * @param options - How failures print the values they read
 * @returns FormRulesValidationResult
 */
export function evaluateRules(
  rules: RulesSection | undefined,
  fieldValues: Record<string, unknown>,
  defsValues: Map<string, unknown>,
  fullContext: EvaluationContext,
  options: RuleEvaluationOptions = {}
): FormRulesValidationResult {
  return evaluateAll(rules, fieldValues, defsValues, fullContext, () => redactingPrinter(options.explain))
}

/**
 * Evaluates a form's rules. A field with no value reads as null. A failed
 * rule's explanation redacts the values of the form's sensitive fields unless
 * `explain.raw` is set.
 *
 * @param form - The form definition
 * @param fieldValues - Field values (flat Record<string, unknown>)
 * @param defsValues - Evaluated defs section values
 * @param fullContext - Full evaluation context
 * @param options - How failures print the values they read
 * @returns FormRulesValidationResult
 */
export function evaluateFormRules(
  form: Form,
  fieldValues: Record<string, unknown>,
  defsValues: Map<string, unknown>,
  fullContext: EvaluationContext,
  options: RuleEvaluationOptions = {}
): FormRulesValidationResult {
  return evaluateAll(form.rules, fieldValues, defsValues, fullContext, (context) =>
    formValuePrinter(form, new Set(Object.keys(context)), options.explain)
  )
}
