/**
 * Fill-state types for progressive form filling.
 *
 * These types support incremental/draft form filling where
 * AI agents and step-by-step UIs build forms turn-by-turn.
 */

import type { EvaluationIssue } from '@/logic/runtime/evaluation/types'
import type { RuleValidationResult } from '@/logic/runtime/evaluation/rule-evaluator'
import type { FormPhase } from '@asterdoc/types'

/** Options for form fill operations. */
export interface FillOptions {
	/** Fixed context captured by the new runtime instance. */
	context?: import('@/artifacts/shared/runtime-context').RuntimeContextOptions
}

/**
 * Options for getFillState / getAvailableFillTargets.
 */
export interface FillTargetOptions {
	/** Sort required targets before optional. Default: true */
	requiredFirst?: boolean
	/** Include optional (non-required) targets in candidates. Default: false */
	includeOptional?: boolean
}

/**
 * Kind of fill target.
 */
export type FillTargetKind = 'field' | 'party' | 'annex'

/**
 * A candidate target that can be filled next.
 */
export interface FillTarget {
	/** Whether this is a field, party role, or annex */
	kind: FillTargetKind
	/** Field id, role id, or annex id */
	key: string
	/** Whether this target is required */
	required: boolean
	/** Stable declaration order used to break ties within a dependency rank */
	order: number
}

/**
 * A field's effective status: the single ordinal that composes `visible` and
 * `required`. `hidden` < `optional` < `required`; `required` implies `visible`,
 * so the impossible "hidden but required" combination cannot be represented.
 */
export type FillItemStatus = 'hidden' | 'optional' | 'required'

/**
 * Extended fill target with runtime state information.
 */
export interface FillItemState extends FillTarget {
	/** Whether this item is currently visible */
	visible: boolean
	/** Effective status: hidden | optional | required (required implies visible) */
	status: FillItemStatus
	/** Whether this item has been filled (has a non-null value) */
	filled: boolean
	/** Transitive unfilled fillable prerequisites gating this item's visibility */
	blockedBy: string[]
}

/**
 * A filled item that does not apply: the condition in its `visible`, or in the
 * `visible` of a field above it, is not met.
 */
export interface InapplicableFillItem extends FillItemState {
	/** The condition that hides the item */
	condition: string
}

/**
 * A party whose name a PDF layer does not print: the layer prints the name
 * from members of the party, and the party gives none of those members.
 */
export interface UnprintedPartyName {
	/** The party role */
	role: string
	/** The position of the party in its role, from 0 */
	index: number
	/** Whether the role holds a list of parties */
	listed: boolean
	/** The key of the PDF layer */
	layer: string
	/** The name members the layer prints for this party */
	members: string[]
}

/**
 * Complete fill state for a draft form.
 */
export interface FillState {
	/** Current form phase */
	phase: FormPhase
	/** Progress summary */
	summary: {
		requiredTotal: number
		requiredDone: number
		requiredRemaining: number
		completionPercent: number
	}
	/** Evaluated defs values */
	defsValues: Record<string, unknown>
	/**
	 * Rule results, the same objects `validateRules()` returns. `valid` is true when
	 * every error-severity rule passed. It is false when the form's logic could not
	 * be resolved, because the rules were not run; `issues` then says why.
	 */
	rules: {
		valid: boolean
		/** Failed rules with severity `error` */
		errors: RuleValidationResult[]
		/** Failed rules with severity `warning` */
		warnings: RuleValidationResult[]
	}
	/** Logic evaluation failures: failed conditions and failed computed values. */
	issues: EvaluationIssue[]
	/** Visible, unfilled, required items */
	openRequired: FillItemState[]
	/** Visible, unfilled, optional items */
	openOptional: FillItemState[]
	/** Not visible but could become visible if dependencies are filled */
	blocked: FillItemState[]
	/** Already filled items */
	done: FillItemState[]
	/**
	 * Values given for items that do not apply: filled, and hidden by a condition
	 * that is not met. The outermost item is listed, not the items inside it. An
	 * item whose `visible` is the literal `false` is never listed, and a value of
	 * `false` or an empty value does not count.
	 */
	notApplicable: InapplicableFillItem[]
	/**
	 * Parties whose name a PDF layer of the form does not print. A layer that
	 * binds `firstName` and `lastName` prints nothing for a party that gives only
	 * `name`.
	 */
	unprintedNames: UnprintedPartyName[]
	/** Available fill targets in dependency order, required before optional by default */
	candidates: FillTarget[]
	/** First candidate (convenience) */
	next: FillTarget | null
}

/** One option of an enum or multiselect target. */
export interface FillBatchOption {
	value: string | number | boolean
	label?: string
}

/**
 * A target that is open now, described for a filler: what it is and how to
 * write its value.
 */
export interface FillBatchTarget {
	kind: FillTargetKind
	/** Field path, party role, or annex id */
	key: string
	required: boolean
	label?: string
	description?: string
	/** Field type, or the party type for a party */
	type?: string
	/** The object shape of a composite value, such as an address or a person */
	shape?: string
	/** How to enter the value, when the type needs a note (place codes, masks) */
	input?: string
	/** The allowed values of an enum or multiselect */
	options?: FillBatchOption[]
	/** The value format of a date, datetime or time */
	format?: string
	/** The limits the value must keep: min, max, step, precision, minLength, maxLength, pattern, mask, minItems, maxItems, currency, country */
	constraints?: Record<string, string | number | boolean>
	/** The type of each row of a list, or of each party of a role that takes more than one party */
	item?: string
	/** The fields of each row of a list whose rows are objects, each keyed by its name in the row */
	rows?: FillBatchTarget[]
	/** The members of a party that a PDF layer of the form prints, such as `firstName` and `lastName` */
	prints?: string[]
	/** The target is open because of a condition on other answers: it, or a field above it, has a `visible` condition */
	conditional?: boolean
}

/** A problem in the data given, at the path of the value. */
export interface FillBatchProblem {
	path: string
	message: string
}

/** A failed rule as a filler sees it. */
export interface FillBatchRule {
	ruleId: string
	message: string
	paths?: string[]
}

/**
 * Everything a filler needs for the next pass: the targets open now, how many
 * wait behind unfilled answers, and what the data already given breaks.
 */
export interface FillBatch {
	/** No required target is open, every rule passes, every value given applies and every party's name prints */
	complete: boolean
	summary: FillState['summary']
	/** Visible, unfilled targets: required first, in dependency order */
	open: FillBatchTarget[]
	/** Hidden targets that can still open, and the open targets they wait on */
	waiting: { count: number; on: string[] }
	rules: { errors: FillBatchRule[]; warnings: FillBatchRule[] }
	/** Conditions or computed values that could not be evaluated */
	issues: FillBatchProblem[]
	/** Values given for targets that do not apply, each with the condition that hides it */
	notApplicable: FillBatchProblem[]
	/** Parties whose name a PDF layer does not print, each with the members the layer prints */
	unprintedNames: FillBatchProblem[]
}
