import { phoneProvider } from '@asterdoc/format/phone'
import type { LayerFormat } from '@asterdoc/types'
import type { DeclaredValue } from './values'

/** A literal a format modifier takes: a string, a number, or a boolean. */
export type ModifierLiteral = string | number | boolean

/** One `key=literal` modifier, at its position in the template. */
export interface FormatModifier {
  key: string
  value: ModifierLiteral
  position: { line: number; column: number }
}

/**
 * What a placeholder's modifiers apply to: the kind of the value it prints and
 * what the artifact declares about it. A declared value's kind is its field,
 * definition, party, or annex type, or a member's presentation kind; any
 * other value's kind is its static type at check and its runtime kind at
 * render. `string` is a string of unknown origin; `unknown` is a value of no
 * known kind.
 */
export interface ModifierTarget {
  kind: string
  declared?: DeclaredValue
  /**
   * The structured value a member sits in, such as the address of a `region`
   * member. `value` is its raw value, and is present at render only.
   */
  owner?: { declared: DeclaredValue; value?: unknown }
}

/**
 * The rule of one format modifier key. `value` says why a literal is not a
 * value of the key; `applies` says why the key cannot apply to a target,
 * including when the metadata it needs is missing. Each returns undefined
 * when there is nothing wrong.
 */
export interface FormatModifierRule {
  value(value: ModifierLiteral): string | undefined
  applies(target: ModifierTarget, value: ModifierLiteral): string | undefined
}

const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/

function literalText(value: ModifierLiteral): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function canonicalLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1
  } catch {
    return false
  }
}

function oneOf(key: string, allowed: readonly string[]): FormatModifierRule['value'] {
  return (value) => typeof value === 'string' && allowed.includes(value)
    ? undefined
    : `${key} takes ${allowed.map((option) => JSON.stringify(option)).join(', ')}, not ${literalText(value)}.`
}

/** A target as messages name it: its declared path and kind, or its kind. */
export function describeTarget(target: ModifierTarget): string {
  const kind = `${/^[aeiou]/.test(target.kind) ? 'an' : 'a'} ${target.kind} value`
  return target.declared ? `${target.declared.path}, ${kind}` : kind
}

/** A rule's `applies` for a key that applies to values of `kinds` only, named `noun` in messages. */
export function onlyFor(key: string, kinds: readonly string[], noun: string): FormatModifierRule['applies'] {
  return (target) => kinds.includes(target.kind) ? undefined : `${key} applies to ${noun}, not to ${describeTarget(target)}.`
}

function label(key: string): FormatModifierRule['value'] {
  return (value) => typeof value === 'string' && value.length <= 200 ? undefined : `${key} takes a string of at most 200 characters, not ${literalText(value)}.`
}

/** A choice prints a label from the options its field declares, so only a declared choice field takes `choice.display`. */
function choiceField(target: ModifierTarget): string | undefined {
  if (target.kind !== 'enum' && target.kind !== 'multiselect') return `choice.display applies to enum and multiselect values, not to ${describeTarget(target)}.`
  return target.declared?.source === 'field' ? undefined : `choice.display needs the options a choice field declares, and ${describeTarget(target)} is not a declared field.`
}

/**
 * Every format modifier key a placeholder can write, with its rule. A key
 * is a dotted path into the layer format; the format it sets merges over the
 * layer's. A phase that adds a format option adds its key here, beside its
 * behavior.
 */
export const FORMAT_MODIFIER_RULES = new Map<string, FormatModifierRule>([
  ['locale', {
    value: (value) => typeof value === 'string' && value.length >= 2 && value.length <= 35 && LOCALE.test(value) && canonicalLocale(value)
      ? undefined
      : `locale takes a BCP 47 language tag such as "en-US", not ${literalText(value)}.`,
    applies: () => undefined,
  }],
  ['date.pattern', {
    value: oneOf('date.pattern', ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
    applies: onlyFor('date.pattern', ['date'], 'dates'),
  }],
  ['money.currencyDisplay', {
    value: oneOf('money.currencyDisplay', ['none']),
    applies: onlyFor('money.currencyDisplay', ['money'], 'money values'),
  }],
  ['phone.style', {
    value: oneOf('phone.style', ['e164', 'international', 'national', 'digits']),
    applies: onlyFor('phone.style', ['phone'], 'phone numbers'),
  }],
  ['phone.region', {
    value: (value) => typeof value === 'string' && phoneProvider.callingCode(value) !== undefined
      ? undefined
      : `phone.region takes the ISO 3166-1 alpha-2 code of a numbering plan, such as "US", not ${literalText(value)}.`,
    applies: onlyFor('phone.region', ['phone'], 'phone numbers'),
  }],
  ['choice.display', {
    value: oneOf('choice.display', ['label', 'value']),
    applies: choiceField,
  }],
  ['boolean.trueLabel', {
    value: label('boolean.trueLabel'),
    applies: onlyFor('boolean.trueLabel', ['boolean'], 'booleans'),
  }],
  ['boolean.falseLabel', {
    value: label('boolean.falseLabel'),
    applies: onlyFor('boolean.falseLabel', ['boolean'], 'booleans'),
  }],
])

const COLLECTIONS = new Set(['list', 'fieldset', 'parties'])

/** A modifier that cannot be used, with why. */
export interface ModifierProblem {
  message: string
  entry: FormatModifier
}

/**
 * Why a modifier list is wrong regardless of what it formats: an unknown key,
 * a value the key does not take, or a key written twice. Undefined when every
 * entry is known and well formed.
 */
export function modifierListProblem(entries: readonly FormatModifier[]): ModifierProblem | undefined {
  const seen = new Set<string>()
  for (const entry of entries) {
    const rule = FORMAT_MODIFIER_RULES.get(entry.key)
    if (!rule) {
      return { entry, message: `Unknown format modifier "${entry.key}". Known modifiers: ${[...FORMAT_MODIFIER_RULES.keys()].join(', ')}.` }
    }
    if (seen.has(entry.key)) return { entry, message: `The format modifier "${entry.key}" is written more than once.` }
    seen.add(entry.key)
    const problem = rule.value(entry.value)
    if (problem) return { entry, message: problem }
  }
  return undefined
}

function targetProblem(target: ModifierTarget, entry: FormatModifier): string | undefined {
  if (COLLECTIONS.has(target.kind)) {
    return `Format modifiers format one value, and ${target.declared?.path ?? 'this expression'} holds several; write them on a placeholder inside {{#each}}.`
  }
  const rule = FORMAT_MODIFIER_RULES.get(entry.key)
  return rule ? rule.applies(target, entry.value) : `Unknown format modifier "${entry.key}".`
}

/**
 * The first modifier no target can take, with why. `targets` are the values
 * a placeholder can print: one, or each branch of a conditional or
 * `coalesce`, or each row a loop can read. Each modifier must apply to at
 * least one of them. An undefined target is one whose kind cannot be known
 * yet, as a branch render does not take; it can take any modifier. Check and
 * render both decide through this rule.
 */
export function inapplicableModifier(
  entries: readonly FormatModifier[],
  targets: readonly (ModifierTarget | undefined)[],
): ModifierProblem | undefined {
  if (targets.some((target) => target === undefined)) return undefined
  for (const entry of entries) {
    const problems = targets.map((target) => targetProblem(target!, entry))
    if (problems.length > 0 && problems.every((problem) => problem !== undefined)) return { entry, message: problems[0]! }
  }
  return undefined
}

/**
 * The modifiers the value that prints takes, at render. A modifier whose kind
 * does not fit this value is left to the other branches; one that fits but
 * lacks what it needs from the data, such as an owner's member, is a problem.
 */
export function chosenModifiers(
  entries: readonly FormatModifier[],
  target: ModifierTarget,
): { entries: FormatModifier[]; problem?: ModifierProblem } {
  const declaredOnly: ModifierTarget = { ...target, ...(target.owner && { owner: { declared: target.owner.declared } }) }
  const applied: FormatModifier[] = []
  for (const entry of entries) {
    if (targetProblem(declaredOnly, entry) !== undefined) continue
    const problem = targetProblem(target, entry)
    if (problem) return { entries: applied, problem: { entry, message: problem } }
    applied.push(entry)
  }
  return { entries: applied }
}

/** The format a list of known, well-formed modifiers sets, each dotted key a path into it. */
export function modifierFormat(entries: readonly FormatModifier[]): LayerFormat {
  const format: Record<string, unknown> = {}
  for (const { key, value } of entries) {
    const segments = key.split('.')
    let at = format
    for (const segment of segments.slice(0, -1)) {
      at[segment] ??= {}
      at = at[segment] as Record<string, unknown>
    }
    at[segments.at(-1)!] = value
  }
  return format as LayerFormat
}
