import type { Expr } from '@asterdoc/expr'

/** The segments of an identifier-rooted path, with literal list indexes, or undefined. */
export function referenceSegments(node: Expr): string[] | undefined {
  if (node.kind === 'Identifier') return [node.name]
  if (node.kind === 'Member') {
    const base = referenceSegments(node.object)
    return base ? [...base, node.property] : undefined
  }
  if (node.kind === 'Index' && ((node.index.kind === 'NumberLiteral' && /^\d+$/.test(node.index.value)) || node.index.kind === 'StringLiteral')) {
    const base = referenceSegments(node.object)
    return base ? [...base, node.index.value] : undefined
  }
  return undefined
}

/**
 * The loop frame `name` binds, innermost first: a DOCX loop's row name, or
 * `item` for the innermost unnamed row and `parent` for the one around it.
 */
export function frameFor<F extends { kind: string; name?: string }>(frames: readonly F[], name: string): F | undefined {
  let rows = 0
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]!
    if (frame.kind === 'named') {
      if (frame.name === name) return frame
      continue
    }
    rows++
    if ((name === 'item' && rows === 1) || (name === 'parent' && rows === 2)) return frame
  }
  return undefined
}

const CONTEXT_ROOTS = new Set(['fields', 'parties'])

/**
 * Why a DOCX loop cannot bind a row name: it would shadow a context root or a
 * computed value, so expressions in the loop would read the row instead.
 * `isDefined` says whether the artifact's expression context defines the name.
 */
export function loopAliasProblem(alias: string, isDefined: (name: string) => boolean): string | undefined {
  if (!CONTEXT_ROOTS.has(alias) && !isDefined(alias)) return undefined
  return `FOR ${alias} shadows ${alias}, which the artifact already defines; name the row something else.`
}
