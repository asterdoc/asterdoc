/**
 * Evaluating template expressions.
 *
 * A template reads the same expression context as the artifact's other
 * expressions. A loop binds its row: `item` (and `parent` for the enclosing
 * row) in text templates, the named variable in DOCX. `index`, `first`, and
 * `last` answer where a row sits, and exist only inside a loop.
 */

import type { Formatter, FormatterProgressivePolicy, LayerFormat } from '@asterdoc/types'
import {
  buildRegistry,
  EvaluationError,
  evaluate,
  T,
  truthy,
  Values,
  type EvaluationContext,
  type Expr,
  type FnSignature,
  type HostFunction,
  type Registry,
  type Value,
} from '@asterdoc/expr'
import {
  FormattedFieldValue,
  formatAttachmentValue,
  formatDefinitionValue,
  formatFieldValue,
  formatPartyValue,
  unwrapFormattedValue,
  type FieldFormattingOptions,
} from '../text/field-formatter'
import { formatFieldOptions, formatterFor, mergeFormats } from '../presentation'
import { TemplateError, type TemplatePosition } from './errors'
import {
  chosenModifiers,
  inapplicableModifier,
  modifierFormat,
  type ModifierProblem,
  type ModifierTarget,
} from './format-modifiers'
import type { FormatModifiers } from './markers'
import { frameFor, referenceSegments } from './paths'
import {
  contextTarget,
  declaredTarget,
  pathContexts,
  printedBranches,
  syntacticKind,
  type RowContext,
} from './targets'
import type { DeclaredValue, TemplateValueResolver } from './values'

export { frameFor, referenceSegments } from './paths'

const DEFAULT_REGISTRY = buildRegistry()

/** Loop-only functions, available to expressions inside a loop and nowhere else. */
export const LOOP_FUNCTIONS: readonly FnSignature[] = [
  { name: 'index', category: 'collection', params: [{ name: 'row', type: T.unknown }], returns: { kind: 'fixed', type: T.number }, hostInjected: true, deterministic: true },
  { name: 'first', category: 'collection', params: [{ name: 'row', type: T.unknown }], returns: { kind: 'fixed', type: T.boolean }, hostInjected: true, deterministic: true },
  { name: 'last', category: 'collection', params: [{ name: 'row', type: T.unknown }], returns: { kind: 'fixed', type: T.boolean }, hostInjected: true, deterministic: true },
]

export const LOOP_FUNCTION_NAMES: ReadonlySet<string> = new Set(LOOP_FUNCTIONS.map((signature) => signature.name))

/** A registry that adds the loop-only functions to `base`. */
export function withLoopFunctions(base: Registry | undefined): Registry {
  const registry = base ?? DEFAULT_REGISTRY
  const signatures = new Map(registry.signatures)
  for (const signature of LOOP_FUNCTIONS) signatures.set(signature.name, signature)
  return {
    signatures,
    has: (name) => signatures.has(name),
    get: (name) => signatures.get(name),
    names: () => [...signatures.keys()],
  }
}

/** Where a loop's rows sit in the artifact, so aggregates skip the rows the artifact hides. */
export interface RowOrigin {
  listPath: string
  indices: readonly number[]
}

export interface Frame {
  /** `each` binds `item` and `parent`; a DOCX loop binds its own name. */
  kind: 'each' | 'named'
  name?: string
  value: Value
  /** The row in the render data: formatted values, and party records with their signing context. */
  data: unknown
  /** The row as the artifact holds it, before any formatting. */
  raw: unknown
  /** Every context the loop source can give this row, one per branch it can read. */
  rows: readonly RowContext[]
  /** The context of the branch the source took, such as the path `['fields', 'lines', '0']`. */
  row: RowContext
  index: number
  count: number
  origin?: RowOrigin
}

/** What a template renders against, beside its expression context. */
export interface TemplateEnvironment {
  /** The layer's formatter: the caller's, in the layer format's locale. */
  formatter: Formatter
  /** The render data at an expression path rooted at `fields`, `parties`, `items`, or a computed value. */
  resolveData(segments: readonly string[]): unknown
  /** The raw data at the same paths, which format modifiers format. */
  resolveRaw(segments: readonly string[]): unknown
  /** The caller's formatter, before the layer's format. */
  callerFormatter: Formatter
  /** The layer's format, under each placeholder's modifiers. */
  format?: LayerFormat
  progressive?: FormatterProgressivePolicy
  /** What the artifact declares at each path, so modifiers format with field metadata. */
  values?: TemplateValueResolver
  layer?: string
}

function runtimeTarget(value: Value, node: Expr, registry: Registry | undefined): ModifierTarget {
  switch (value.kind) {
    case 'array': return { kind: 'list' }
    case 'object': {
      const amount = value.value.get('amount')
      const currency = value.value.get('currency')
      return { kind: amount?.kind === 'number' && currency?.kind === 'string' ? 'money' : 'object' }
    }
    case 'string': return { kind: stringReturnKind(node, registry) ?? 'string' }
    default: return { kind: value.kind }
  }
}

function stringReturnKind(node: Expr, registry: Registry | undefined): 'date' | 'datetime' | undefined {
  const signature = node.kind === 'Call' ? (registry ?? DEFAULT_REGISTRY).get(node.callee) : undefined
  const returns = signature?.returns.kind === 'fixed' ? signature.returns.type.kind : undefined
  return returns === 'date' || returns === 'datetime' ? returns : undefined
}

const VALUE_KINDS = new Set(['number', 'date', 'datetime', 'money', 'boolean'])

function formatDeclared(formatter: Formatter, declared: DeclaredValue, raw: unknown, options: FieldFormattingOptions): unknown {
  switch (declared.source) {
    case 'field': return formatFieldValue(formatter, declared.field, raw, declared.path, options)
    case 'definition': return formatDefinitionValue(formatter, declared.kind, raw, declared.path, options)
    case 'party': return formatPartyValue(formatter, declared.party.partyType, raw, declared.path, options)
    case 'annex': return formatAttachmentValue(formatter, raw, declared.path, options)
    case 'member': return VALUE_KINDS.has(declared.kind) ? formatDefinitionValue(formatter, declared.kind, raw, declared.path, options) : raw
  }
}

interface ChosenValue {
  target?: ModifierTarget
  declared?: DeclaredValue
  path?: readonly string[]
  value?: Value
}

const blocked = new Set(['__proto__', 'constructor', 'prototype'])

/** Read a path through render data, looking through formatted wrappers on the way down. */
export function dataPath(value: unknown, segments: readonly string[]): unknown {
  let current = value
  for (const [index, segment] of segments.entries()) {
    current = unwrapFormattedValue(current)
    if (blocked.has(segment) || current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
    if (index === segments.length - 1) return current
  }
  return current
}

/** Plain JavaScript for an expression value, for directives that read records. */
export function fromValue(value: Value): unknown {
  switch (value.kind) {
    case 'number': return value.value.toNumber()
    case 'string':
    case 'boolean': return value.value
    case 'null': return null
    case 'array': return value.value.map(fromValue)
    case 'object': return Object.fromEntries([...value.value].map(([key, member]) => [key, fromValue(member)]))
  }
}

function isPlainRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !(value instanceof FormattedFieldValue)
}

export class TemplateScope {
  constructor(
    readonly root: EvaluationContext,
    readonly environment: TemplateEnvironment,
    readonly frames: readonly Frame[] = [],
  ) {}

  push(frame: Frame): TemplateScope {
    return new TemplateScope(this.root, this.environment, [...this.frames, frame])
  }

  /** The innermost row, whatever binds it. */
  current(): Frame | undefined {
    return this.frames.at(-1)
  }

  frameFor(name: string): Frame | undefined {
    return frameFor(this.frames, name)
  }

  context(): EvaluationContext {
    if (this.frames.length === 0) return this.root
    const rowFunction = (answer: (frame: Frame) => Value): HostFunction => (args) => {
      const frame = this.frames.find((candidate) => candidate.value === args[0])
      if (!frame) throw new EvaluationError('type-error', 'index, first, and last take a loop row, such as item')
      return answer(frame)
    }
    const rowVisible = this.root.rowVisible
    return {
      lookup: (name) => this.frameFor(name)?.value ?? this.root.lookup(name),
      asOf: this.root.asOf,
      registry: withLoopFunctions(this.root.registry),
      hostFunctions: {
        ...this.root.hostFunctions,
        index: rowFunction((frame) => Values.num(String(frame.index))),
        first: rowFunction((frame) => Values.boolean(frame.index === 0)),
        last: rowFunction((frame) => Values.boolean(frame.index === frame.count - 1)),
      },
      rowVisible: rowVisible && ((listPath, indices) => {
        const [head, ...rest] = listPath.split('.')
        const frame = head ? this.frameFor(head) : undefined
        if (!frame) return rowVisible(listPath, indices)
        if (!frame.origin) return true
        return rowVisible([frame.origin.listPath, ...rest].join('.'), [...frame.origin.indices, ...indices])
      }),
    }
  }

  evaluate(node: Expr, source: string, position: TemplatePosition): Value {
    try {
      return evaluate(node, this.context())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof EvaluationError ? error.code : 'evaluation-error'
      throw new TemplateError({ code, message, expression: source, position }, this.environment.layer)
    }
  }

  /** The branch of a conditional or `coalesce` that prints, or undefined when every `coalesce` argument is missing. */
  chosenBranch(node: Expr, source: string, position: TemplatePosition): Expr | undefined {
    if (node.kind === 'Conditional') {
      return this.chosenBranch(truthy(this.evaluate(node.test, source, position)) ? node.consequent : node.alternate, source, position)
    }
    if (node.kind === 'Call' && node.callee === 'coalesce') {
      for (const arg of node.args) {
        if (this.evaluate(arg, source, position).kind !== 'null') return this.chosenBranch(arg, source, position)
      }
      return undefined
    }
    return node
  }

  /** The raw data an expression reads, when it is a path into it. */
  rawAt(node: Expr): unknown {
    const segments = referenceSegments(node)
    if (!segments) return undefined
    const [head, ...rest] = segments
    const frame = head ? this.frameFor(head) : undefined
    if (frame) return rest.length === 0 ? frame.raw : dataPath(frame.raw, rest)
    return this.environment.resolveRaw(segments)
  }

  /** The render data an expression reads, when it is a path into it. */
  dataAt(node: Expr): unknown {
    const segments = referenceSegments(node)
    if (!segments) return undefined
    const [head, ...rest] = segments
    const frame = head ? this.frameFor(head) : undefined
    if (frame) return rest.length === 0 ? frame.data : dataPath(frame.data, rest)
    return this.environment.resolveData(segments)
  }

  /** Where the rows of a list path sit in the artifact, when the list is a path it declares. */
  originOf(node: Expr): RowOrigin | undefined {
    const segments = referenceSegments(node)
    if (!segments) return undefined
    const [head, ...rest] = segments
    const frame = head ? this.frameFor(head) : undefined
    if (frame) {
      return frame.origin
        ? { listPath: [frame.origin.listPath, ...rest].join('.'), indices: frame.origin.indices }
        : undefined
    }
    return head === 'fields' ? { listPath: segments.join('.'), indices: [] } : undefined
  }

  /**
   * The text a placeholder prints. A path prints the value the way the
   * artifact formats it; a computed value is formatted by its type. With
   * format modifiers, each modifier must apply to one of the values the
   * placeholder can print, under the rule check applies; the value that
   * prints takes those that apply to it, and its raw value is formatted with
   * its declared metadata and the layer's format and the modifiers merged
   * over it.
   */
  present(node: Expr, source: string, position: TemplatePosition, modifiers?: FormatModifiers): string {
    if (modifiers) return this.presentModified(node, source, position, modifiers)
    if (node.kind === 'Conditional' || (node.kind === 'Call' && node.callee === 'coalesce')) {
      const chosen = this.chosenBranch(node, source, position)
      return chosen ? this.present(chosen, source, position) : ''
    }
    if (referenceSegments(node)) {
      const data = this.dataAt(node)
      if (data !== undefined && !isPlainRecord(data) && !Array.isArray(data)) {
        return data === null ? '' : String(data)
      }
      if (data instanceof FormattedFieldValue) return String(data)
    }
    return this.formatValue(this.evaluate(node, source, position), node)
  }

  private presentModified(node: Expr, source: string, position: TemplatePosition, modifiers: FormatModifiers): string {
    const chosenNode = this.chosenBranch(node, source, position)
    const chosen = chosenNode ? this.chosenValue(chosenNode, source, position) : undefined
    const targets = printedBranches(node).flatMap((branch) => branch === chosenNode
      ? this.possibleTargets(branch).map((target) => target ?? chosen?.target)
      : this.possibleTargets(branch))
    const fail = (problem: ModifierProblem): never => {
      throw new TemplateError({ code: 'format-modifier', message: problem.message, expression: modifiers.text, position: problem.entry.position }, this.environment.layer)
    }
    const problem = inapplicableModifier(modifiers.entries, targets)
    if (problem) fail(problem)
    if (!chosenNode || !chosen?.target) return ''
    const applied = chosenModifiers(modifiers.entries, chosen.target)
    if (applied.problem) fail(applied.problem)
    const { callerFormatter, progressive } = this.environment
    const effective = mergeFormats(this.environment.format, modifierFormat(applied.entries))
    const formatter = formatterFor(callerFormatter, effective)
    const options = formatFieldOptions(effective, progressive === undefined ? {} : { progressive })
    const modified = { path: source, options }
    if (chosen.declared) {
      const formatted = formatDeclared(formatter, chosen.declared, this.environment.resolveRaw(chosen.path!), options)
      if (formatted === null || formatted === undefined) return ''
      if (!isPlainRecord(formatted) && !Array.isArray(formatted)) return String(formatted)
      return this.formatValue(this.evaluate(chosenNode, source, position), chosenNode, formatter, modified)
    }
    const value = chosen.value!
    if (value.kind !== 'null' && VALUE_KINDS.has(chosen.target.kind) && chosen.target.kind !== runtimeTarget(value, chosenNode, this.root.registry).kind) {
      return String(formatDefinitionValue(formatter, chosen.target.kind, fromValue(value), source, options))
    }
    return this.formatValue(value, chosenNode, formatter, modified)
  }

  private chosenValue(node: Expr, source: string, position: TemplatePosition): ChosenValue {
    const context = pathContexts(node, this.frames, true)?.[0]
    if (context && 'path' in context) {
      const declared = this.environment.values?.describe(context.path)
      if (declared) {
        const target = declaredTarget(declared)
        if (target.owner) target.owner.value = this.environment.resolveRaw(context.path.slice(0, -1))
        return { target, declared, path: context.path }
      }
    }
    const value = this.evaluate(node, source, position)
    if (context && 'kind' in context) return { target: { kind: context.kind }, value }
    return { ...(value.kind !== 'null' && { target: runtimeTarget(value, node, this.root.registry) }), value }
  }

  private possibleTargets(branch: Expr): (ModifierTarget | undefined)[] {
    const contexts = pathContexts(branch, this.frames)
    if (contexts) return contexts.map((context) => contextTarget(context, this.environment.values))
    const kind = syntacticKind(branch, this.root.registry)
    return [kind === undefined ? undefined : { kind }]
  }

  private formatValue(value: Value, node: Expr, formatter = this.environment.formatter, modified?: { path: string; options: FieldFormattingOptions }): string {
    switch (value.kind) {
      case 'null': return ''
      case 'boolean': return formatter.formatBoolean(value.value)
      case 'number': return formatter.formatNumber(value.value.toNumber())
      case 'string': {
        const returns = stringReturnKind(node, this.root.registry)
        if (returns && modified) return String(formatDefinitionValue(formatter, returns, value.value, modified.path, modified.options))
        if (returns === 'date') return formatter.formatDate(value.value)
        if (returns === 'datetime') return formatter.formatDatetime(value.value)
        return value.value
      }
      case 'array': return value.value.map((element) => this.formatValue(element, node, formatter, modified)).join(', ')
      case 'object': {
        const amount = value.value.get('amount')
        const currency = value.value.get('currency')
        if (amount?.kind === 'number' && currency?.kind === 'string') {
          const money = { amount: amount.value.toNumber(), currency: currency.value }
          return modified
            ? String(formatDefinitionValue(formatter, 'money', money, modified.path, modified.options))
            : formatter.formatMoney(money)
        }
        return ''
      }
    }
  }
}
