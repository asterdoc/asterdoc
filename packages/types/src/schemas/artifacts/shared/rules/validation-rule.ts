/**
 * Validation Rule types for form-level validation
 */

/**
 * Severity level for validation rules.
 * - 'error': Blocks form submission (default)
 * - 'warning': Allows submission but shows warning
 */
export type RuleSeverity = 'error' | 'warning';

/**
 * A form-level validation rule.
 *
 * Rules use expressions to validate cross-field constraints.
 * The expression has direct access to field values (e.g., "ssn or ein")
 * and defs section values.
 */
export interface ValidationRule {
  /** Boolean expression that must evaluate to true for the form to be valid. */
  expr: string;
  /** Error message displayed when the rule fails (expression evaluates to false). */
  message: string;
  /** Severity level: 'error' (default) blocks submission, 'warning' allows but warns. */
  severity?: RuleSeverity;
  /**
   * Field paths the failure attaches to, such as `fields.ssn`. Each names a
   * field. Without paths the failure is form level; paths are never inferred
   * from the expression.
   */
  paths?: readonly string[];
}

/**
 * Rules section for form-level validation.
 * Keys are rule identifiers, values are validation rules.
 */
export interface RulesSection {
  [ruleId: string]: ValidationRule;
}
