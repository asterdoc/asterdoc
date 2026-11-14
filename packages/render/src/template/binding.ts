import type { Expr } from '@asterdoc/expr'
import type { ValueFormat, ValuePart } from '@asterdoc/types'
import { SIGNING_DIRECTIVES } from './directives'
import { describeLocation, TemplateError } from './errors'
import { PART_MODIFIER } from './format-modifiers'
import { parseTemplate, type TemplateNode } from './markers'
import { referenceSegments } from './paths'

/** One value placeholder of a binding template. */
export interface BindingTemplateSlot {
  /** The placeholder's expression as written. */
  source: string
  /** The root-anchored path the placeholder prints, such as `['fields', 'city']`; undefined for a computed value. */
  segments?: string[]
  /** The format the placeholder's modifiers set. */
  format?: ValueFormat
  /** The part of the value a `part` modifier prints. */
  part?: ValuePart
}

/** One piece of the text a binding template prints: its own text, or a placeholder. */
export type BindingTemplatePiece = { text: string } | { slot: BindingTemplateSlot }

/** A parsed binding template. */
export interface BindingTemplate {
  /** The template as written. */
  source: string
  nodes: readonly TemplateNode[]
  /** Every root-anchored path a placeholder reads, in the order written. */
  references: string[][]
  /**
   * Every sequence of pieces the template can print, one for each combination
   * of its blocks. Undefined when it has more than {@link MAX_TEMPLATE_VARIANTS}.
   */
  variants?: BindingTemplatePiece[][]
  /** Whether the template's own text holds a line break. */
  lineBreak: boolean
}

/** The most combinations of blocks a binding template is expanded into. */
export const MAX_TEMPLATE_VARIANTS = 64

function isExpr(value: unknown): value is Expr {
  return typeof value === 'object' && value !== null && 'kind' in value && 'span' in value
}

function collectReferences(node: Expr, found: string[][]): void {
  const segments = referenceSegments(node)
  if (segments) {
    found.push(segments)
    return
  }
  for (const value of Object.values(node)) {
    if (isExpr(value)) collectReferences(value, found)
    else if (Array.isArray(value)) for (const element of value) if (isExpr(element)) collectReferences(element, found)
  }
}

function merged(pieces: BindingTemplatePiece[]): BindingTemplatePiece[] {
  const result: BindingTemplatePiece[] = []
  for (const piece of pieces) {
    const last = result.at(-1)
    if ('text' in piece && last && 'text' in last) result[result.length - 1] = { text: last.text + piece.text }
    else result.push(piece)
  }
  return result
}

function variantsOf(nodes: readonly TemplateNode[]): BindingTemplatePiece[][] | undefined {
  let variants: BindingTemplatePiece[][] = [[]]
  for (const node of nodes) {
    let choices: BindingTemplatePiece[][]
    if (node.type === 'text') choices = [[{ text: node.value }]]
    else if (node.type === 'value') {
      const { slot } = node
      const segments = slot.ast ? referenceSegments(slot.ast) : undefined
      const part = slot.modifiers?.entries.find((entry) => entry.key === PART_MODIFIER)?.value as ValuePart | undefined
      const hasFormat = slot.modifiers !== undefined && Object.keys(slot.modifiers.format).length > 0
      choices = [[{
        slot: {
          source: slot.source,
          ...(segments && { segments }),
          ...(hasFormat && { format: slot.modifiers!.format }),
          ...(part !== undefined && { part }),
        },
      }]]
    } else {
      const taken = variantsOf(node.children)
      const skipped = variantsOf(node.inverse)
      if (!taken || !skipped) return undefined
      choices = [...taken, ...skipped]
    }
    variants = variants.flatMap((variant) => choices.map((choice) => [...variant, ...choice]))
    if (variants.length > MAX_TEMPLATE_VARIANTS) return undefined
  }
  return variants
}

function structureProblem(nodes: readonly TemplateNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === 'text') continue
    if (node.type === 'value') {
      const { ast } = node.slot
      if (ast?.kind === 'Call' && SIGNING_DIRECTIVES.has(ast.callee)) {
        return `has a template with the signing directive ${ast.callee}(); a PDF layer places signing marks through its signature slots`
      }
      continue
    }
    if (node.type === 'each') {
      return 'has a template with an {{#each}} loop; a PDF field prints a fixed text, so bind each list row to its own field, such as fields.lines[0].amount'
    }
    const problem = structureProblem(node.children) ?? structureProblem(node.inverse)
    if (problem) return problem
  }
  return undefined
}

function collect(nodes: readonly TemplateNode[], references: string[][]): boolean {
  let lineBreak = false
  for (const node of nodes) {
    if (node.type === 'text') lineBreak ||= /[\r\n]/.test(node.value)
    else if (node.type === 'value') {
      if (node.slot.ast) collectReferences(node.slot.ast, references)
    } else {
      lineBreak = collect(node.children, references) || lineBreak
      lineBreak = collect(node.inverse, references) || lineBreak
    }
  }
  return lineBreak
}

/**
 * Parse a binding template. The result is the template, or the problem that
 * makes it unreadable, worded to follow `Binding "…" `: markers that do not
 * pair, an `{{#each}}` loop, or a signing directive. An expression that does
 * not parse is kept on its node, as in a text layer: checking reports each
 * one, and rendering fails on it.
 */
export function parseBindingTemplate(source: string): { template: BindingTemplate } | { problem: string } {
  let nodes: TemplateNode[]
  try {
    nodes = parseTemplate(source)
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error
    const where = describeLocation(error.diagnostic)
    return { problem: `has a template that does not parse${where ? ` at ${where}` : ''}: ${error.diagnostic.message.replace(/\.$/, '')}` }
  }
  const problem = structureProblem(nodes)
  if (problem) return { problem }
  const references: string[][] = []
  const lineBreak = collect(nodes, references)
  const variants = variantsOf(nodes)?.map(merged)
  return { template: { source, nodes, references, ...(variants && { variants }), lineBreak } }
}

const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The expression that reads a binding path, such as `fields.lines[0].amount` for `lines.0.amount`. */
export function pathExpression(segments: readonly string[]): string {
  return segments.reduce((expression, segment) => {
    if (expression === '') return segment
    if (/^\d+$/.test(segment)) return `${expression}[${segment}]`
    return BARE_IDENTIFIER.test(segment) ? `${expression}.${segment}` : `${expression}[${JSON.stringify(segment)}]`
  }, '')
}

/**
 * The template that prints what a comma-joined binding of schema 2026-11-10
 * printed: each value, with `, ` between the values that are not empty.
 * `expressions` are the root-anchored segments of each joined path, in order.
 */
export function joinedTemplate(expressions: readonly (readonly string[])[]): string {
  const paths = expressions.map(pathExpression)
  return paths.map((path, index) => {
    if (index === 0) return `{{${path}}}`
    const earlier = paths.slice(0, index).map((other) => `isNotEmpty(${other})`).join(' or ')
    return `{{#if isNotEmpty(${path})}}{{#if ${earlier}}}, {{/if}}{{${path}}}{{/if}}`
  }).join('')
}
