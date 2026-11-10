import { INVALID_PHONE, MISSING_FORMAT_PROVIDER, PHONE_PROVIDER_ENTRY_POINT, PHONE_REGION_MISMATCH, redactedValue } from '@asterdoc/format'
import type { FormatResult, Formatter, LayerPhoneFormat, ValuePart } from '@asterdoc/types'
import { ArtifactFieldFormatError } from '../text/field-formatter'
import { UNSUPPORTED_PART } from './rules'

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function refuse(path: string, kind: string, status: string, code: string, message: string | { message: string; redactedMessage: string }): never {
  const texts = typeof message === 'string' ? { message } : message
  throw new ArtifactFieldFormatError(path, kind, status, [{ code, ...texts, path, kind }])
}

function aboutValue(value: string | number, write: (shown: string) => string): { message: string; redactedMessage: string } {
  return { message: write(String(value)), redactedMessage: write(redactedValue(value)) }
}

function checked(result: FormatResult, path: string, kind: string): boolean {
  if (result.success) return true
  if (result.status === 'missing') return false
  throw new ArtifactFieldFormatError(path, kind, result.status, result.issues.map((issue) => ({ ...issue, path, kind })))
}

function datePart(formatter: Formatter, value: unknown, part: ValuePart, path: string): string | undefined {
  if (!checked(formatter.safeFormatDate(value as string), path, 'date')) return undefined
  const match = typeof value === 'string' ? CALENDAR_DATE.exec(value) : null
  if (!match) refuse(path, 'date', 'invalid', 'invalid_value', `The part "${part}" needs a calendar date written YYYY-MM-DD.`)
  const [, year, month, day] = match as unknown as [string, string, string, string]
  return part === 'year' ? year : part === 'month' ? month : day
}

function phonePart(formatter: Formatter, value: unknown, part: ValuePart, path: string, phone: LayerPhoneFormat | undefined): string | undefined {
  if (!checked(formatter.safeFormatPhone(value as string, { style: 'e164' }), path, 'phone')) return undefined
  const record = typeof value === 'string' ? { number: value } : value as { number: string; extension?: string }
  if (part === 'extension') return record.extension === undefined || record.extension === '' ? undefined : record.extension
  const provider = formatter.providers.phone
  if (!provider) {
    refuse(path, 'phone', 'unsupported', MISSING_FORMAT_PROVIDER,
      `The phone part "${part}" needs the phone provider: create the formatter with providers: { phone: phoneProvider } from ${PHONE_PROVIDER_ENTRY_POINT}.`)
  }
  const parsed = provider.parse(record.number)
  if (!parsed) refuse(path, 'phone', 'invalid', INVALID_PHONE, aboutValue(record.number, (shown) => `${shown} is not a valid phone number in any numbering plan, so its part "${part}" cannot be printed.`))
  if (phone?.region !== undefined) {
    const expected = provider.callingCode(phone.region)
    if (expected !== parsed.countryCallingCode) {
      refuse(path, 'phone', 'invalid', PHONE_REGION_MISMATCH, aboutValue(record.number, (shown) =>
        `${shown} has country calling code +${parsed.countryCallingCode}, but the box expects a number of region ${phone.region}${expected === undefined ? '' : ` (+${expected})`}, so its part "${part}" cannot be printed.`))
    }
  }
  if (part === 'countryCode') return parsed.countryCallingCode
  if (part === 'nationalNumber') return parsed.nationalNumber
  if (parsed.countryCallingCode !== '1' || parsed.nationalNumber.length !== 10) {
    refuse(path, 'phone', 'unsupported', UNSUPPORTED_PART, aboutValue(record.number, (shown) =>
      `The phone part "${part}" exists only for +1 numbers, and ${shown} has country calling code +${parsed.countryCallingCode}.`))
  }
  return part === 'areaCode' ? parsed.nationalNumber.slice(0, 3) : parsed.nationalNumber.slice(3)
}

function minorDigits(currency: string): number {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

const TWO_DECIMALS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
})

/**
 * A non-negative amount rounded half-expand to two decimals, as Intl rounds
 * whole money, split into its units and cents digits.
 */
export function splitAmount(amount: number): { units: string; cents: string } {
  const [units, cents] = TWO_DECIMALS.format(amount + 0).split('.') as [string, string]
  return { units, cents }
}

function moneyPart(formatter: Formatter, value: unknown, part: ValuePart, path: string): string | undefined {
  if (!checked(formatter.safeFormatMoney(value as { amount: number; currency: string }), path, 'money')) return undefined
  const { amount, currency } = value as { amount: number; currency: string }
  if (minorDigits(currency) !== 2) {
    refuse(path, 'money', 'unsupported', UNSUPPORTED_PART, aboutValue(currency, (shown) =>
      `The money part "${part}" needs a currency with two minor digits, and ${shown} has ${minorDigits(currency)}.`))
  }
  if (amount < 0) {
    refuse(path, 'money', 'unsupported', UNSUPPORTED_PART, aboutValue(amount, (shown) => `The money part "${part}" prints only amounts of zero or more, not ${shown}.`))
  }
  const { units, cents } = splitAmount(amount)
  return part === 'units' ? units : cents
}

/**
 * The piece of a value a part prints, as plain digits: never formatted again
 * as a whole value, so money digit and grouping options do not apply. A money
 * amount is rounded half-expand to two decimals before it is split.
 * Undefined when the value, or the piece, is absent.
 *
 * @throws {ArtifactFieldFormatError} for an invalid value; with
 * `unsupported_part` for `areaCode` or `subscriberNumber` outside +1, a
 * negative amount, or a currency without two minor digits; with
 * `phone_region_mismatch` for a phone part other than `extension` of a number
 * outside the plan `phone.region` names; with `missing_format_provider` for a
 * phone part the formatter's providers cannot read.
 */
export function printValuePart(
  formatter: Formatter,
  kind: string,
  value: unknown,
  part: ValuePart,
  path: string,
  options: { phone?: LayerPhoneFormat } = {},
): string | undefined {
  if (value === null || value === undefined) return undefined
  try {
    if (kind === 'date') return datePart(formatter, value, part, path)
    if (kind === 'phone') return phonePart(formatter, value, part, path, options.phone)
    if (kind === 'money') return moneyPart(formatter, value, part, path)
  } catch (error) {
    if (error instanceof ArtifactFieldFormatError) throw error
    refuse(path, kind, 'error', 'formatter_error', error instanceof Error ? error.message : 'Unexpected formatter failure.')
  }
  return refuse(path, kind, 'unsupported', UNSUPPORTED_PART, `A ${kind} value has no part "${part}".`)
}
