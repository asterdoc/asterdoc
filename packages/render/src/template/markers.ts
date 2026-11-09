/**
 * Block markers of text, Markdown, and HTML templates.
 *
 * The markers are `{{#if}}`, `{{#unless}}`, `{{else}}`, `{{#each}}`, their
 * closing tags, comments, and value placeholders (`{{ }}` escaped, `{{{ }}}`
 * raw). Everything inside a marker is an artifact expression, parsed
 * here once so rendering and checking read the same tree.
 */

import { parse, type Expr } from '@asterdoc/expr'
import type { ValueFormat } from '@asterdoc/types'
import { removedSyntaxHint, TemplateError, type TemplateDiagnostic, type TemplatePosition } from './errors'
import { modifierFormat, modifierListProblem, type FormatModifier, type ModifierLiteral } from './format-modifiers'

export interface ExpressionSlot {
  /** Expression source as written. */
  source: string
  /** Parsed expression, or undefined when it does not parse. */
  ast?: Expr
  /** Why it does not parse, with the replacement for removed syntax. */
  problem?: TemplateDiagnostic
  position: TemplatePosition
  /** The format modifiers a value placeholder writes after a single `|`. */
  modifiers?: FormatModifiers
}

/**
 * The format modifiers of one placeholder, such as
 * `date.pattern="MM/DD/YYYY", locale="en-US"`. They are not part of the
 * expression: the placeholder's expression prints, and they choose how.
 */
export interface FormatModifiers {
  /** The whole placeholder as written, expression and modifiers, for messages. */
  text: string
  entries: FormatModifier[]
  /** The format the modifiers set, merged over the layer's format. */
  format: ValueFormat
  /** Why the modifiers do not parse, or name an unknown key or a value the key does not take. */
  problem?: TemplateDiagnostic
}

export interface TextNode {
  type: 'text'
  value: string
}

export interface ValueNode {
  type: 'value'
  slot: ExpressionSlot
  escaped: boolean
}

export interface BlockNode {
  type: 'if' | 'unless' | 'each'
  slot: ExpressionSlot
  children: TemplateNode[]
  inverse: TemplateNode[]
}

export type TemplateNode = TextNode | ValueNode | BlockNode

/** Offsets to 1-based line and column, for one template source. */
export function positionFinder(source: string, base: TemplatePosition = { line: 1, column: 1 }): (offset: number) => TemplatePosition {
  const lineStarts = [0]
  for (let index = 0; index < source.length; index++) if (source[index] === '\n') lineStarts.push(index + 1)
  return (offset) => {
    let line = 0
    while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= offset) line++
    const column = offset - lineStarts[line]! + 1
    return line === 0
      ? { line: base.line, column: base.column + column - 1 }
      : { line: base.line + line, column }
  }
}

/** Parse one expression, keeping any problem for validation to report. */
export function expressionSlot(source: string, position: TemplatePosition): ExpressionSlot {
  const trimmed = source.trim()
  if (trimmed === '') {
    return { source: trimmed, position, problem: { code: 'syntax', message: 'The marker holds no expression.', expression: trimmed, position } }
  }
  const { ast, errors } = parse(trimmed)
  if (ast) return { source: trimmed, ast, position }
  const hint = removedSyntaxHint(trimmed)
  return {
    source: trimmed,
    position,
    problem: {
      code: hint ? 'removed-syntax' : 'syntax',
      message: hint ?? errors[0]?.message ?? 'The expression does not parse.',
      expression: trimmed,
      position,
    },
  }
}

/**
 * The offset of the `|` that starts a placeholder's format modifiers: the
 * first single `|` outside a string literal, or -1. `||` is never a
 * separator; the expression parser refuses it as it always has.
 */
export function modifierSeparator(source: string): number {
  let quote: string | undefined
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (quote !== undefined) {
      if (char === '\\') index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '|') {
      if (source[index + 1] === '|') index++
      else return index
    }
  }
  return -1
}

const CLOSING_QUOTE: Readonly<Record<string, string>> = { '"': '"', "'": "'", '\u201C': '\u201D', '\u2018': '\u2019' }
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r' }

class ModifierSyntaxError extends Error {
  constructor(message: string, readonly offset: number) {
    super(message)
  }
}

function parseModifierList(source: string, base: number): Array<{ key: string; value: ModifierLiteral; offset: number }> {
  const entries: Array<{ key: string; value: ModifierLiteral; offset: number }> = []
  let index = 0
  const skipSpace = () => {
    while (index < source.length && /\s/.test(source[index]!)) index++
  }
  const fail = (message: string): never => {
    throw new ModifierSyntaxError(message, base + index)
  }
  const literal = (key: string): ModifierLiteral => {
    const char = source[index]
    const closing = char === undefined ? undefined : CLOSING_QUOTE[char]
    if (closing !== undefined) {
      const start = index
      index++
      let value = ''
      while (index < source.length && source[index] !== closing) {
        if (source[index] === '\\' && index + 1 < source.length) {
          const next = source[index + 1]!
          value += ESCAPES[next] ?? next
          index += 2
          continue
        }
        value += source[index]
        index++
      }
      if (index >= source.length) {
        index = start
        return fail(`The value of ${key} is a string with no closing quote.`)
      }
      index++
      return value
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(source.slice(index))
    if (number) {
      index += number[0].length
      return Number(number[0])
    }
    const word = /^(?:true|false)\b/.exec(source.slice(index))
    if (word) {
      index += word[0].length
      return word[0] === 'true'
    }
    return fail(`The value of ${key} must be a string, number, or boolean literal, such as ${key}="value".`)
  }

  skipSpace()
  if (index >= source.length) fail('A | starts format modifiers, written key=value, such as date.pattern="MM/DD/YYYY".')
  for (;;) {
    skipSpace()
    const offset = index
    const key = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(source.slice(index))?.[0]
    if (!key) fail('A format modifier is written key=value, such as date.pattern="MM/DD/YYYY".')
    index += key!.length
    skipSpace()
    if (source[index] !== '=') fail(`The format modifier ${key} needs a value: write ${key}=value.`)
    index++
    skipSpace()
    entries.push({ key: key!, value: literal(key!), offset: base + offset })
    skipSpace()
    if (index >= source.length) return entries
    if (source[index] !== ',') fail('Separate format modifiers with commas, such as locale="en-US", date.pattern="MM/DD/YYYY".')
    index++
  }
}

/**
 * Parse a value placeholder: its expression, and the format modifiers after
 * the first single `|` outside a string literal. A string literal in the
 * modifiers may use straight or curly quotes, since Word turns `"` into `“`.
 */
export function valueSlot(source: string, position: TemplatePosition): ExpressionSlot {
  const text = source.trimStart()
  const separator = modifierSeparator(text)
  if (separator === -1) return expressionSlot(text, position)
  const positionAt = positionFinder(text, position)
  const slot = expressionSlot(text.slice(0, separator), position)
  const whole = text.trim()
  const modifiers: FormatModifiers = { text: whole, entries: [], format: {} }
  try {
    modifiers.entries = parseModifierList(text.slice(separator + 1), separator + 1)
      .map(({ key, value, offset }) => ({ key, value, position: positionAt(offset) }))
  } catch (error) {
    if (!(error instanceof ModifierSyntaxError)) throw error
    modifiers.problem = { code: 'syntax', message: error.message, expression: whole, position: positionAt(error.offset) }
    return { ...slot, modifiers }
  }
  const problem = modifierListProblem(modifiers.entries)
  if (problem) {
    modifiers.problem = { code: 'format-modifier', message: problem.message, expression: whole, position: problem.entry.position }
    return { ...slot, modifiers }
  }
  modifiers.format = modifierFormat(modifiers.entries)
  return { ...slot, modifiers }
}

/** The rule a block marker with format modifiers breaks. */
export const BLOCK_MODIFIER_RULE = 'A block marker takes no format modifiers; write them on a value placeholder, such as {{item.date | date.pattern="MM/DD/YYYY"}}.'

/**
 * Parse the expression of a block marker or DOCX control command. A block
 * marker takes no format modifiers, so a single `|` in it is a `markers`
 * problem.
 */
export function blockSlot(source: string, position: TemplatePosition): ExpressionSlot {
  if (modifierSeparator(source) === -1) return expressionSlot(source, position)
  const trimmed = source.trim()
  return { source: trimmed, position, problem: { code: 'markers', message: BLOCK_MODIFIER_RULE, expression: trimmed, position } }
}

const TAG = /\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g

/**
 * Parse a text template into nodes. Malformed or mismatched markers throw a
 * {@link TemplateError}; an expression that does not parse is kept on its
 * node, so validation can report every one of them.
 */
export function parseTemplate(template: string, base?: TemplatePosition): TemplateNode[] {
  const positionAt = positionFinder(template, base)
  const root: TemplateNode[] = []
  const stack: Array<{ block: BlockNode; output: TemplateNode[]; tag: string; position: TemplatePosition }> = []
  let output = root
  let cursor = 0
  let skipLineBreak = false

  const fail = (message: string, offset: number): never => {
    throw new TemplateError({ code: 'markers', message, position: positionAt(offset) })
  }

  /** A block marker alone on its line takes the line with it. */
  const standalone = (start: number, end: number): boolean => {
    const lineStart = template.lastIndexOf('\n', start - 1) + 1
    const lineEndIndex = template.indexOf('\n', end)
    const lineEnd = lineEndIndex === -1 ? template.length : lineEndIndex
    return /^[\t ]*$/.test(template.slice(lineStart, start)) && /^[\t \r]*$/.test(template.slice(end, lineEnd))
  }

  const pushText = (value: string) => {
    let text = value
    if (skipLineBreak) {
      text = text.replace(/^[\t ]*\r?\n?/, '')
      skipLineBreak = false
    }
    if (text.length > 0) output.push({ type: 'text', value: text })
  }

  const trimLineBefore = () => {
    const last = output.at(-1)
    if (last?.type !== 'text') return
    last.value = last.value.replace(/[\t ]*$/, '')
    if (last.value.length === 0) output.pop()
  }

  for (const match of template.matchAll(TAG)) {
    const index = match.index ?? 0
    const token = match[0]
    const end = index + token.length
    if (index > cursor) pushText(template.slice(cursor, index))
    else if (skipLineBreak) skipLineBreak = false
    cursor = end

    const triple = token.startsWith('{{{')
    const inner = token.slice(triple ? 3 : 2, triple ? -3 : -2)
    const innerOffset = index + (triple ? 3 : 2) + (inner.length - inner.trimStart().length)
    const content = inner.trim()

    if (!triple && content.startsWith('!')) continue

    const isBlockTag = !triple && (content.startsWith('#') || content.startsWith('/') || content === 'else')
    if (isBlockTag && standalone(index, end)) {
      trimLineBefore()
      skipLineBreak = true
    }

    if (!triple && content.startsWith('#')) {
      const body = content.slice(1)
      const name = body.match(/^\S*/)?.[0] ?? ''
      const expression = body.slice(name.length)
      if (name === 'with') fail('{{#with}} is removed; write full paths, such as parties.tenant.name.', index)
      if (name !== 'if' && name !== 'unless' && name !== 'each') fail(`Unsupported block {{#${name}}}; use {{#if}}, {{#unless}}, or {{#each}}.`, index)
      const expressionOffset = innerOffset + 1 + name.length + (expression.length - expression.trimStart().length)
      const slot = blockSlot(expression, positionAt(expressionOffset))
      if (slot.problem?.code === 'markers') fail(slot.problem.message, index)
      const block: BlockNode = {
        type: name as BlockNode['type'],
        slot,
        children: [],
        inverse: [],
      }
      output.push(block)
      stack.push({ block, output, tag: name, position: positionAt(index) })
      output = block.children
      continue
    }

    if (!triple && content === 'else') {
      const current = stack.at(-1)
      if (!current) fail('Unexpected {{else}}', index)
      if (output === current!.block.inverse) fail('A block has more than one {{else}}', index)
      output = current!.block.inverse
      continue
    }

    if (!triple && content.startsWith('/')) {
      const name = content.slice(1).trim()
      const current = stack.pop()
      if (!current || current.tag !== name) fail(`Unexpected closing block {{/${name}}}`, index)
      output = current!.output
      continue
    }

    output.push({ type: 'value', slot: valueSlot(inner, positionAt(innerOffset)), escaped: !triple })
  }

  if (cursor < template.length) pushText(template.slice(cursor))
  const open = stack.at(-1)
  if (open) throw new TemplateError({ code: 'markers', message: `Unclosed block {{#${open.tag}}}`, position: open.position })
  return root
}
