import type { Form, ValuePart } from '@asterdoc/types'
import { pathSegments } from '../path'
import { formValueResolver, type DeclaredValue } from '../template/values'

/** The kinds of value that have parts, each with the parts it has. */
export const VALUE_PARTS: Readonly<Record<'date' | 'phone' | 'money', readonly ValuePart[]>> = Object.freeze({
  date: ['year', 'month', 'day'],
  phone: ['countryCode', 'nationalNumber', 'extension', 'areaCode', 'subscriberNumber'],
  money: ['units', 'cents'],
})

/** Every part of every kind. */
export const ALL_VALUE_PARTS: readonly ValuePart[] = Object.values(VALUE_PARTS).flat()

/** The code a part fails with at render when the value it reads has no such piece, such as `areaCode` on a number outside +1. */
export const UNSUPPORTED_PART = 'unsupported_part'

/** Whether `value` names a part of some kind of value. */
export function isValuePart(value: unknown): value is ValuePart {
  return typeof value === 'string' && (ALL_VALUE_PARTS as readonly string[]).includes(value)
}

/** The parts a kind of value has, or undefined for a kind without parts. */
export function partsOf(kind: string): readonly ValuePart[] | undefined {
  return Object.prototype.hasOwnProperty.call(VALUE_PARTS, kind) ? VALUE_PARTS[kind as keyof typeof VALUE_PARTS] : undefined
}

const quoted = (parts: readonly string[]) => parts.map((part) => JSON.stringify(part)).join(', ')

/**
 * Why `part` cannot apply to a value of `kind`, or undefined when it can.
 * `what` names the value in the message, such as `fields.dob, a text value`.
 */
export function partProblem(kind: string, part: unknown, what: string): string | undefined {
  if (!isValuePart(part)) return `part takes ${quoted(ALL_VALUE_PARTS)}, not ${typeof part === 'string' ? JSON.stringify(part) : String(part)}.`
  const parts = partsOf(kind)
  if (!parts) return `part applies to date, phone and money values, not to ${what}.`
  return parts.includes(part) ? undefined : `A ${kind} value has no part "${part}"; its parts are ${quoted(parts)}.`
}

/**
 * What the artifact declares at a binding path: a field (through list items
 * and fieldsets), a member, a party, or a computed value under `defs`.
 */
export function bindingDeclaration(form: Form, source: string): DeclaredValue | undefined {
  const trimmed = source.trim()
  const segments = pathSegments(trimmed.startsWith('fields.') ? trimmed.slice('fields.'.length) : trimmed)
  const [root, ...rest] = segments
  if (root === undefined) return undefined
  const resolver = formValueResolver(form)
  if (root === 'defs') return resolver.describe(rest)
  if (root === 'parties' || root === 'annexes') return resolver.describe(segments)
  return resolver.describe(['fields', ...segments])
}
