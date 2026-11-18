import { phoneProvider } from '@asterdoc/format/phone'
import type { Form, ValueFormat, ValuePart } from '@asterdoc/types'
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

interface PlanNeed {
  code: string | undefined
  because: string
}

function phonePlanNeeds(part: ValuePart | undefined, format: ValueFormat | undefined): PlanNeed[] {
  const phone = format?.phone
  const needs: PlanNeed[] = []
  const region = phone?.region
  const regionRefuses = part === undefined ? phone?.style === 'national' || phone?.style === 'digits' : part !== 'extension'
  if (region !== undefined && regionRefuses) {
    needs.push({
      code: phoneProvider.callingCode(region),
      because: part === undefined
        ? `it prints as ${phone!.style} under phone.region "${region}", which refuses a number of another plan`
        : `phone.region "${region}" refuses the part "${part}" of a number of another plan`,
    })
  }
  if (part === 'areaCode' || part === 'subscriberNumber') needs.push({ code: '1', because: `the part "${part}" exists only for +1 numbers` })
  return needs
}

function phonePrintProblem(declared: DeclaredValue, part: ValuePart | undefined, format: ValueFormat | undefined): string | undefined {
  const field = declared.source === 'field' && declared.field.type === 'phone' ? declared.field : undefined
  for (const need of phonePlanNeeds(part, format)) {
    if (need.code === undefined) return `${need.because}, and that region has no numbering plan, so every number is refused`
    if (field?.countryCode === need.code) continue
    if (!field) return `${need.because}, and ${declared.path} cannot state the plan of its numbers; bind a phone field with "countryCode": "${need.code}"`
    const accepts = field.countryCode === undefined ? 'numbers of every plan' : `only +${field.countryCode} numbers`
    return `${need.because}, and ${declared.path} accepts ${accepts}; give the field "countryCode": "${need.code}"`
  }
  return undefined
}

function minorDigits(currency: string): number | undefined {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
  } catch {
    return undefined
  }
}

function moneyPrintProblem(declared: DeclaredValue, part: ValuePart | undefined): string | undefined {
  if (part !== 'units' && part !== 'cents') return undefined
  const field = declared.source === 'field' && declared.field.type === 'money' ? declared.field : undefined
  const because = `the part "${part}" needs a currency with two minor digits and an amount of zero or more`
  if (!field) return `${because}, and ${declared.path} cannot state its currency or least amount; bind a money field with "currency" and "min": 0`
  if (field.currency === undefined) return `${because}, and ${declared.path} accepts every currency; give the field a "currency" with two minor digits, such as "USD"`
  if (minorDigits(field.currency) !== 2) return `${because}, and ${declared.path} takes ${field.currency}, which has ${minorDigits(field.currency) ?? 'no known'} minor digits`
  if (field.min === undefined || field.min < 0) return `${because}, and ${declared.path} accepts amounts below zero; give the field "min": 0`
  return undefined
}

function placeFormatProblem(declared: DeclaredValue, format: ValueFormat | undefined): string | undefined {
  const display = (['country', 'region'] as const).filter((kind) => format?.[kind]?.display !== undefined)
  if (display.length === 0) return undefined
  const address = declared.kind === 'address' ? declared : declared.source === 'member' && declared.owner.kind === 'address' ? declared.owner : undefined
  if (!address) return undefined
  const shown = declared.kind === 'address' ? display : display.filter((kind) => kind === declared.kind)
  if (shown.length === 0) return undefined
  const field = address.source === 'field' && address.field.type === 'address' ? address.field : undefined
  if (field?.codes === true) return undefined
  const formats = shown.map((kind) => `${kind}.display`).join(' and ')
  if (!field) return `${formats} needs the country and region stored as codes, and ${address.path} cannot store them so; bind an address field with "codes": true`
  return `${formats} needs the country and region stored as codes, and ${address.path} stores what it is given; give the field "codes": true`
}

/**
 * Why printing the value `declared` names, as `part` (or whole) under
 * `format`, can fail for a value its declaration accepts, or undefined when
 * every accepted value prints. A phone's `areaCode` and `subscriberNumber`
 * need a field with `countryCode` `1`; `phone.region` under `national` or
 * `digits`, or with a part other than `extension`, needs the field's
 * `countryCode` to be the region's. A money `units` or `cents` part needs a
 * field with a two-decimal `currency` and `min` of zero or more. A
 * `country.display` or `region.display` on an address, or on its `country` or
 * `region` member, needs an address field with `codes: true`.
 */
export function printProblem(declared: DeclaredValue | undefined, part: ValuePart | undefined, format: ValueFormat | undefined): string | undefined {
  if (declared?.kind === 'phone') return phonePrintProblem(declared, part, format)
  if (declared?.kind === 'money') return moneyPrintProblem(declared, part)
  return declared ? placeFormatProblem(declared, format) : undefined
}
