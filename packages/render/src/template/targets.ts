import { buildRegistry, type Expr, type ExprType, type Registry } from '@asterdoc/expr'
import type { ModifierTarget } from './format-modifiers'
import { frameFor, referenceSegments } from './paths'
import type { DeclaredValue, TemplateValueResolver } from './values'

const DEFAULT_REGISTRY = buildRegistry()

/**
 * Where a loop row, or a value read through it, comes from: a declared
 * root-anchored path, or only a kind. Check and render derive both the same
 * way, from the loop source's expression, so they agree on what a row is.
 */
export type RowContext = { readonly path: readonly string[] } | { readonly kind: string }

/**
 * A loop frame as targets read it. `rows` holds every context the loop's
 * source can give its rows: one per branch of a conditional or `coalesce`
 * source, through enclosing loops. At render, `row` is the context of the
 * branch the source took.
 */
export interface ContextFrame {
  kind: 'each' | 'named'
  name?: string
  rows: readonly RowContext[]
  row?: RowContext
}

/** The kind of a static type, as modifiers read it. */
export function staticKind(type: ExprType): string {
  return type.kind === 'array' ? 'list' : type.kind
}

/** The expressions a placeholder or loop source can print or read: each branch of a conditional or `coalesce`. */
export function printedBranches(node: Expr): Expr[] {
  if (node.kind === 'Conditional') return [...printedBranches(node.consequent), ...printedBranches(node.alternate)]
  if (node.kind === 'Call' && node.callee === 'coalesce') return node.args.flatMap(printedBranches)
  return [node]
}

/**
 * The contexts a path expression reads, one per row its loop can read, or
 * through each loop's chosen row when `chosen` is set. Undefined when the
 * expression is not a path.
 */
export function pathContexts(node: Expr, frames: readonly ContextFrame[], chosen = false): RowContext[] | undefined {
  const segments = referenceSegments(node)
  if (!segments) return undefined
  const [head, ...rest] = segments
  const frame = head ? frameFor(frames, head) : undefined
  if (!frame) return [{ path: segments }]
  const rows = chosen && frame.row ? [frame.row] : frame.rows
  return rows.map((row) => 'path' in row ? { path: [...row.path, ...rest] } : { kind: rest.length === 0 ? row.kind : 'unknown' })
}

function fixedReturn(node: Expr, registry: Registry | undefined): ExprType | undefined {
  if (node.kind !== 'Call') return undefined
  const signature = (registry ?? DEFAULT_REGISTRY).get(node.callee)
  return signature?.returns.kind === 'fixed' ? signature.returns.type : undefined
}

/**
 * The row contexts a loop source gives row `index`: for each branch, the
 * declared row of a path, or the element kind a function's declared return
 * type gives, or `unknown`.
 */
export function sourceRows(node: Expr, frames: readonly ContextFrame[], index: string, registry: Registry | undefined, chosen = false): RowContext[] {
  return printedBranches(node).flatMap((branch): RowContext[] => {
    const contexts = pathContexts(branch, frames, chosen)
    if (contexts) return contexts.map((context) => 'path' in context ? { path: [...context.path, index] } : { kind: 'unknown' })
    const returns = fixedReturn(branch, registry)
    return [{ kind: returns?.kind === 'array' ? staticKind(returns.element) : 'unknown' }]
  })
}

/** The target of a declared value. */
export function declaredTarget(declared: DeclaredValue): ModifierTarget {
  return { kind: declared.kind, declared, ...(declared.source === 'member' && { owner: { declared: declared.owner } }) }
}

/** The target a context gives, or undefined for a path the artifact declares nothing at. */
export function contextTarget(context: RowContext, values: TemplateValueResolver | undefined): ModifierTarget | undefined {
  if ('kind' in context) return { kind: context.kind }
  const declared = values?.describe(context.path)
  return declared ? declaredTarget(declared) : undefined
}

/** The kind a computed expression has before it runs: a literal's, or a function's declared return type. */
export function syntacticKind(node: Expr, registry: Registry | undefined): string | undefined {
  switch (node.kind) {
    case 'StringLiteral': return 'string'
    case 'NumberLiteral': return 'number'
    case 'BooleanLiteral': return 'boolean'
    default: {
      const returns = fixedReturn(node, registry)
      return returns ? staticKind(returns) : undefined
    }
  }
}
