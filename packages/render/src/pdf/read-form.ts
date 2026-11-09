import { defaultFormatter } from '../default-formatter'
import { phoneProvider } from '@asterdoc/format/phone'
import { resolveAddressRegion, resolveCountry, resolveRegion, type PlaceOutcome } from '@asterdoc/format'
import type { BinaryContent, Bindings, EnumOption, EnumOptionValue, Form, FormField, Formatter, LayerBooleanFormat, LayerCountryFormat, LayerDateFormat, LayerFormat, LayerPhoneFormat, LayerRegionFormat, ValuePart } from '@asterdoc/types'
import { validateFieldBindings } from '../text/field-formatter'
import { assertBindingFormats, fieldDefinition, parseBindings, resolveLayerBindings, splitPartIndex } from '../layer-bindings'
import { formatterFor, mergeFormats } from '../presentation'
import { bindingDeclaration } from '../parts/rules'
import { pathSegments } from '../path'
import { acroFields, type AcroField } from './acroform'
import { isName, PdfEncryptedError, PdfModel, type PdfValue } from './syntax'
import { byteString, decodeTextString } from './text-string'

/** Why a PDF could not be read as the artifact's filled form. */
export type PdfExtractionErrorCode =
  | 'malformed_pdf'
  | 'no_form_fields'
  | 'not_matching'
  | 'no_pdf_layer'
  | 'layer_required'
  | 'layer_not_found'
  | 'not_pdf_layer'
  | 'unknown_bindings_source'

/** Extraction refused the input. `code` says which failure case applies. */
export class PdfExtractionError extends Error {
  readonly code: PdfExtractionErrorCode

  constructor(code: PdfExtractionErrorCode, message: string) {
    super(message)
    this.name = 'PdfExtractionError'
    this.code = code
  }
}

/** What happened to one artifact path the layer's bindings target. */
export type PdfExtractionStatus = 'recovered' | 'empty' | 'not_recoverable' | 'unparseable'

/** One PDF field that carries a binding target, with the raw value read from it. */
export interface PdfExtractionSource {
  /** Fully qualified AcroForm field name. */
  field: string
  /** Raw PDF value: the text, the selected option, or a button state name. Absent when the field has none. */
  value?: string
}

/** One entry per artifact path the layer's bindings target. */
export interface PdfExtractionEntry {
  /** The binding target, as written in the layer's bindings. */
  path: string
  status: PdfExtractionStatus
  /** Every PDF field that carries this path. */
  sources: PdfExtractionSource[]
  /** Why the value is not recoverable or could not be parsed. */
  reason?: string
  /**
   * Set on every `recovered` entry: true when the format the value was
   * printed with drops detail, so the recovered value is the person's answer
   * but may not be exactly the one filled.
   */
  lossy?: boolean
}

/** A PDF field that holds a value no binding covers. */
export interface PdfUnboundField {
  field: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown'
  value: string
}

export interface PdfExtractionReport {
  entries: PdfExtractionEntry[]
  unbound: PdfUnboundField[]
}

/** Partial artifact data in the fill payload shape. It holds only recovered values, never guesses; a lossy one is flagged in the report. */
export interface PdfExtractedData {
  fields: Record<string, unknown>
  parties?: Record<string, unknown>
  annexes?: Record<string, unknown>
}

export interface PdfExtraction {
  data: PdfExtractedData
  report: PdfExtractionReport
}

export interface ExtractPdfDataOptions {
  /** The filled PDF. It is read, never modified. */
  pdf: BinaryContent
  /** The artifact whose layer produced the PDF. */
  form: Form
  /** The PDF layer's bindings: AcroForm field name to artifact path, as strings or binding objects. */
  bindings: Bindings
  /** The formatter the PDF was filled with. Defaults to the default formatter. */
  formatter?: Formatter
  /**
   * The format the PDF layer declares, applied over `formatter` as it was
   * when filling, with each binding's own format merged over it. With
   * `money.currencyDisplay: 'none'`, an amount is read in the currency its
   * field declares.
   */
  format?: LayerFormat
}

// ---------------------------------------------------------------------------
// Reading the PDF
// ---------------------------------------------------------------------------

interface FieldState {
  field: AcroField
  /** Raw text for text and dropdown fields, the state name for buttons. */
  raw?: string
  /** Every selected dropdown value. */
  selected?: string[]
  /** For buttons: whether a non-Off state is set. */
  on?: boolean
}

function stateName(value: PdfValue | undefined): string | undefined {
  if (isName(value)) return value.value
  return typeof value === 'string' ? value : undefined
}

function buttonState(model: PdfModel, field: AcroField): string | undefined {
  const value = stateName(model.resolve(field.dict.entries.get('V')))
  if (value !== undefined) return value
  const states = field.widgets
    .map((widget) => stateName(model.resolve(widget.dict.entries.get('AS'))))
    .filter((state): state is string => state !== undefined)
  return states.find((state) => state !== 'Off') ?? states[0]
}

function readField(model: PdfModel, field: AcroField): FieldState {
  if (field.type === 'checkbox' || field.type === 'radio') {
    const raw = buttonState(model, field)
    return { field, raw, on: raw !== undefined && raw !== 'Off' }
  }
  const value = model.resolve(field.dict.entries.get('V'))
  if (field.type === 'dropdown') {
    const selected = (Array.isArray(value) ? value : [value])
      .map((entry) => typeof entry === 'string' ? decodeTextString(entry) : undefined)
      .filter((entry): entry is string => entry !== undefined && entry.trim() !== '')
    return { field, raw: selected.length > 0 ? selected.join(', ') : undefined, selected }
  }
  const decoded = typeof value === 'string' ? decodeTextString(value) : undefined
  const text = decoded !== undefined && decoded.trim() !== '' ? decoded : undefined
  return { field, raw: text }
}

function assertReadablePdf(bytes: Uint8Array): void {
  const head = byteString(bytes.subarray(0, 1024))
  if (!head.includes('%PDF-')) {
    throw new PdfExtractionError('malformed_pdf', 'The input is not a PDF: it has no %PDF- header.')
  }
  // A cut-off incremental update still holds the earlier revision's marker, so
  // the file must end at its last one.
  const tail = byteString(bytes.subarray(Math.max(0, bytes.length - 2048)))
  const end = tail.lastIndexOf('%%EOF')
  if (end === -1 || !/^[\s\0]*$/.test(tail.slice(end + 5))) {
    throw new PdfExtractionError('malformed_pdf', 'The PDF is truncated: it does not end with an end-of-file marker.')
  }
}

async function loadFormFields(bytes: BinaryContent): Promise<{ model: PdfModel; fields: AcroField[]; names: ReadonlySet<string> }> {
  assertReadablePdf(bytes)
  let model: PdfModel
  try {
    model = await PdfModel.load(bytes)
  } catch (error) {
    if (error instanceof PdfEncryptedError) throw error
    throw new PdfExtractionError('malformed_pdf', `The PDF could not be parsed: ${error instanceof Error ? error.message : String(error)}`)
  }
  let fields: AcroField[]
  try {
    fields = acroFields(model)?.fields ?? []
  } catch (error) {
    throw new PdfExtractionError('malformed_pdf', `The PDF could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  const fillable = fields.filter((field) => field.type !== 'signature' && field.type !== 'button' && field.type !== 'unknown')
  if (fillable.length === 0) {
    throw new PdfExtractionError(
      'no_form_fields',
      'The PDF has no AcroForm fields to read. Flattened and scanned documents need the hosted Asterdoc extraction service.',
    )
  }
  return { model, fields: fillable, names: new Set(fields.map((field) => field.name)) }
}

// ---------------------------------------------------------------------------
// Binding targets
// ---------------------------------------------------------------------------

type Target =
  /** A declared field, written with the formatter's text. */
  | { kind: 'field'; field: FormField }
  /** A member of a structured value or a party, written as its raw value; a phone's `number` as its phone style prints it. */
  | { kind: 'member'; type: 'number' | 'text' | 'phoneNumber'; place?: AddressPlace }
  /** Something extraction cannot write back: a computed value, an annex, a whole party. */
  | { kind: 'fixed'; reason: string }

type AddressPlace = { member: 'country' } | { member: 'region'; countryPath: string }

/** The member paths of structured values that hold numbers, as bindings write them. */
const numericMembers: Record<string, ReadonlySet<string>> = {
  money: new Set(['amount']),
  coordinate: new Set(['lat', 'lon']),
  bbox: new Set(['southWest.lat', 'southWest.lon', 'northEast.lat', 'northEast.lon']),
}

function targetFor(form: Form, path: string): Target {
  const segments = pathSegments(path)
  const [root, ...rest] = segments
  if (root === 'parties') {
    return rest.length >= 2 && !(rest.length === 2 && /^\d+$/.test(rest[1]!))
      ? { kind: 'member', type: 'text' }
      : { kind: 'fixed', reason: 'A whole party is written as formatted text; bind its parts to recover them.' }
  }
  if (root === 'defs') return { kind: 'fixed', reason: 'Computed values are derived from other data, not read back.' }
  if (root === 'annexes') return { kind: 'fixed', reason: 'Annexes are attachments, not form field values.' }
  let field = root ? form.fields?.[root] : undefined
  if (!field) return { kind: 'fixed', reason: 'The path is artifact metadata, not a data value.' }
  for (let index = 0; index < rest.length; index++) {
    const segment = rest[index]!
    if (field.type === 'list' && /^\d+$/.test(segment)) field = field.item
    else if (field.type === 'fieldset' && field.fields[segment]) field = field.fields[segment]!
    else {
      const member = rest.slice(index).join('.')
      if (field.type === 'phone' && member === 'number') return { kind: 'member', type: 'phoneNumber' }
      const place: AddressPlace | undefined = field.type !== 'address' ? undefined
        : member === 'country' ? { member: 'country' }
          : member === 'region' ? { member: 'region', countryPath: [...segments.slice(0, index + 1), 'country'].join('.') }
            : undefined
      return { kind: 'member', type: numericMembers[field.type]?.has(member) ? 'number' : 'text', ...(place && { place }) }
    }
  }
  return { kind: 'field', field }
}

// ---------------------------------------------------------------------------
// Parsing values
// ---------------------------------------------------------------------------

type Parsed = { ok: true; value: unknown; lossy: boolean } | { ok: false; reason: string; lost?: true }

const ok = (value: unknown, lossy = false): Parsed => ({ ok: true, value, lossy })
const fail = (reason: string): Parsed => ({ ok: false, reason })
const lost = (reason: string): Parsed => ({ ok: false, reason, lost: true })

function placeParsed(outcome: PlaceOutcome): Parsed {
  if (outcome.ok) return ok(outcome.value)
  const ambiguous = outcome.code === 'ambiguous_country' || outcome.code === 'ambiguous_region' || outcome.code === 'needs_country'
  return ambiguous ? lost(outcome.message) : fail(outcome.message)
}

function readCountry(raw: string, formatter: Formatter): Parsed {
  return placeParsed(resolveCountry(raw, { locale: formatter.locale, regions: formatter.providers.regions }))
}

const FULL_REGION_CODE = /^[A-Za-z]{2}-[A-Za-z0-9]{1,3}$/

function readAddressRegion(raw: string, country: string | undefined, formatter: Formatter): Parsed {
  const regions = formatter.providers.regions
  const text = raw.trim()
  if (country !== undefined) return placeParsed(resolveAddressRegion(text, country, regions))
  if (!FULL_REGION_CODE.test(text)) return lost('A subdivision name or short code is read in its address country; bind the address country to recover it.')
  const full = placeParsed(resolveRegion(text, { regions }))
  return full.ok ? ok(String(full.value).slice(String(full.value).indexOf('-') + 1)) : full
}

function numberSymbols(locale: string): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
    return {
      group: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    }
  } catch {
    return { group: ',', decimal: '.' }
  }
}

function parseNumber(raw: string, locale: string): number | undefined {
  const text = raw.trim()
  if (/^[-+]?\d+(\.\d+)?$/.test(text)) return Number(text)
  const { group, decimal } = numberSymbols(locale)
  const grouped = text.split(group).join('').replace(/[\s\u00a0\u202f]/g, '').replace(/\u2212/g, '-')
  const normalized = decimal === '.' ? grouped : grouped.split(decimal).join('.')
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return undefined
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

function isoDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function numericDateOrder(locale: string): Array<'year' | 'month' | 'day'> {
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })
      .formatToParts(new Date(Date.UTC(2000, 0, 2)))
      .map((part) => part.type)
      .filter((type): type is 'year' | 'month' | 'day' => type === 'year' || type === 'month' || type === 'day')
  } catch {
    return ['month', 'day', 'year']
  }
}

function monthIndex(token: string, locale: string): number | undefined {
  const needle = token.replace(/\.$/, '').toLocaleLowerCase(locale)
  for (const style of ['long', 'short'] as const) {
    const format = new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' })
    for (let month = 0; month < 12; month++) {
      const name = format.format(new Date(Date.UTC(2000, month, 1))).replace(/\.$/, '').toLocaleLowerCase(locale)
      if (name === needle) return month + 1
    }
  }
  return undefined
}

function parsePatternDate(raw: string, date: LayerDateFormat): string | undefined {
  const text = raw.trim()
  if (date.pattern === 'YYYY-MM-DD') {
    const parts = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    return parts ? isoDate(Number(parts[1]), Number(parts[2]), Number(parts[3])) : undefined
  }
  const parts = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!parts) return undefined
  const [first, second, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  return date.pattern === 'MM/DD/YYYY' ? isoDate(year, first, second) : isoDate(year, second, first)
}

function parseDate(raw: string, locale: string): string | undefined {
  const text = raw.trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const numeric = text.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/)
  if (numeric) {
    const values = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])]
    const order = numericDateOrder(locale)
    if (order.length !== 3) return undefined
    const part = (type: 'year' | 'month' | 'day') => values[order.indexOf(type)]!
    const yearText = numeric[order.indexOf('year') + 1]!
    if (yearText.length !== 4) return undefined
    return isoDate(part('year'), part('month'), part('day'))
  }

  const tokens = text.split(/[\s,]+/).filter(Boolean)
  if (tokens.length !== 3) return undefined
  let month: number | undefined
  const numbers: string[] = []
  for (const token of tokens) {
    if (/^\d+\.?$/.test(token)) numbers.push(token.replace(/\.$/, ''))
    else if (month === undefined) month = monthIndex(token, locale)
    else return undefined
  }
  if (month === undefined || numbers.length !== 2) return undefined
  const year = numbers.find((value) => value.length === 4)
  const day = numbers.find((value) => value.length <= 2)
  if (!year || !day) return undefined
  return isoDate(Number(year), month, Number(day))
}

function parseTime(raw: string): string | undefined {
  const text = raw.trim()
  const clock = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/)
  if (clock) return text
  const meridiem = text.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*([AaPp])\.?\s*[Mm]\.?$/)
  if (!meridiem) return undefined
  const hour = Number(meridiem[1])
  if (hour < 1 || hour > 12) return undefined
  const pm = meridiem[4]!.toLowerCase() === 'p'
  const hours = String((hour % 12) + (pm ? 12 : 0)).padStart(2, '0')
  return `${hours}:${meridiem[2]}${meridiem[3] ? `:${meridiem[3]}` : ''}`
}

/**
 * Match text to one option. PDF fill writes option values, so a value matches
 * before a label; a label or a case-insensitive match is taken only when no
 * value matches exactly.
 */
function matchOption(raw: string, options: readonly EnumOption[], formatter: Formatter): EnumOption | undefined {
  const label = (option: EnumOption) => {
    const result = formatter.safeFormatEnum(option.value, { options })
    return result.success ? result.value : option.label ?? String(option.value)
  }
  const byValue = options.filter((option) => String(option.value) === raw)
  if (byValue.length === 1) return byValue[0]
  const byLabel = options.filter((option) => label(option) === raw)
  if (byLabel.length === 1) return byLabel[0]
  const folded = raw.trim().toLowerCase()
  const loose = options.filter((option) => String(option.value).toLowerCase() === folded || label(option).toLowerCase() === folded)
  return loose.length === 1 ? loose[0] : undefined
}

let currencyCodes: readonly string[] | undefined

function currencies(): readonly string[] {
  if (currencyCodes) return currencyCodes
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  try {
    currencyCodes = intl.supportedValuesOf?.('currency') ?? []
  } catch {
    currencyCodes = []
  }
  if (currencyCodes.length === 0) currencyCodes = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR', 'MXN']
  return currencyCodes
}

function parseMoney(raw: string, field: FormField, formatter: Formatter): Parsed {
  const text = raw.trim()
  const amountText = text.replace(/^[^\d(+\-\u2212]+|[^\d)]+$/g, '').replace(/^\((.*)\)$/, '-$1')
  const amount = parseNumber(amountText, formatter.locale)
  if (amount === undefined) return fail('The value is not an amount of money.')
  // A field that declares its currency accepts no other, so only it is tried.
  const declared = field.type === 'money' ? field.currency : undefined
  const preferred = field.type === 'money' && field.default?.currency ? [field.default.currency] : []
  const candidates = declared
    ? [declared]
    : [...preferred, ...currencies().filter((code) => !preferred.includes(code))]
  const matches = new Set<string>()
  for (const currency of candidates) {
    const result = formatter.safeFormatMoney({ amount, currency })
    if (result.success && result.value === text) matches.add(currency)
    if (matches.size > 1) break
  }
  if (matches.size === 1) return ok({ amount, currency: [...matches][0] })
  return fail(matches.size === 0
    ? 'The currency cannot be determined from the text; write the amount with its currency symbol, or bind the amount on its own.'
    : 'The text matches more than one currency; declare the field\'s currency, or write the amount with its currency symbol.')
}

const composite = new Set(['address', 'person', 'organization', 'identification', 'coordinate', 'bbox', 'list', 'fieldset'])

/** Parse text written into one PDF field back into the field's type. */
interface Reader {
  formatter: Formatter
  date?: LayerDateFormat
  country?: LayerCountryFormat
  region?: LayerRegionFormat
  phone?: LayerPhoneFormat
  choice?: 'label' | 'value'
  boolean?: LayerBooleanFormat
}

function optionLabel(option: EnumOption, options: readonly EnumOption[], formatter: Formatter): string {
  const result = formatter.safeFormatEnum(option.value, { options })
  return result.success ? result.value : option.label ?? String(option.value)
}

function sharedLabelReason(label: string): string {
  return `More than one option prints the label "${label}", so the value cannot be told apart.`
}

/** How a printed label is compared once it does not match exactly: without surrounding space, and without regard to case. */
function normalizedLabel(label: string): string {
  return label.trim().toLocaleLowerCase()
}

/**
 * The one candidate whose label is the text: an exact match first, then a
 * normalized one. More than one candidate at either step cannot be told apart.
 */
function matchLabelOf<T>(raw: string, candidates: readonly { value: T; label: string }[]): { value: T } | { ambiguous: string } | undefined {
  for (const same of [(label: string) => label === raw, (label: string) => normalizedLabel(label) === normalizedLabel(raw)]) {
    const matches = candidates.filter((candidate) => same(candidate.label))
    if (matches.length > 1) return { ambiguous: matches[0]!.label }
    if (matches.length === 1) return { value: matches[0]!.value }
  }
  return undefined
}

/** Match text printed as an option label to its option. Two options with that label cannot be told apart. */
function matchLabel(raw: string, options: readonly EnumOption[], formatter: Formatter): Parsed | undefined {
  const match = matchLabelOf(raw, options.map((option) => ({ value: option.value, label: optionLabel(option, options, formatter) })))
  if (!match) return undefined
  return 'ambiguous' in match ? lost(sharedLabelReason(match.ambiguous)) : ok(match.value)
}

const LIST_MARKERS = ['\u0001', '\u0002', '\u0003', '\u0004']

/** The separators the formatter's list joins labels with: two, three and four labels give every one. */
function listSeparators(formatter: Formatter): string[] {
  const options = LIST_MARKERS.map((label, index) => ({ value: index, label }))
  const separators = new Set<string>()
  for (let count = 2; count <= LIST_MARKERS.length; count++) {
    const result = formatter.safeFormatMultiselect(options.slice(0, count).map((option) => option.value), { options })
    if (!result.success) continue
    let rest = result.value
    for (const marker of LIST_MARKERS.slice(0, count)) {
      const at = rest.indexOf(marker)
      if (at > 0) separators.add(rest.slice(0, at))
      rest = rest.slice(at + marker.length)
    }
  }
  return [...separators]
}

/**
 * Match text printed as a list of option labels. Every reading of the text
 * into labels and the list's separators is tried, and only one that the
 * formatter prints back exactly counts; more than one is ambiguous.
 */
function matchLabelList(raw: string, options: readonly EnumOption[], formatter: Formatter): Parsed | undefined {
  const text = raw.trim()
  const labels = options.map((option) => optionLabel(option, options, formatter))
  const separators = listSeparators(formatter)
  const readings = new Map<string, EnumOptionValue[]>()
  const visit = (position: number, chosen: number[]): void => {
    if (readings.size > 1) return
    labels.forEach((label, index) => {
      if (chosen.includes(index) || !label || !text.startsWith(label, position)) return
      const next = [...chosen, index]
      const end = position + label.length
      if (end === text.length) {
        const values = next.map((choice) => options[choice]!.value)
        const printed = formatter.safeFormatMultiselect(values, { options })
        if (printed.success && printed.value === text) readings.set(JSON.stringify(values), values)
        return
      }
      for (const separator of separators) {
        if (text.startsWith(separator, end)) visit(end + separator.length, next)
      }
    })
  }
  visit(0, [])
  if (readings.size > 1) return lost('The text reads as more than one selection, because options share a label.')
  const [values] = readings.values()
  return values ? ok(values) : undefined
}

function parseBooleanLabels(raw: string, labels: LayerBooleanFormat, formatter: Formatter): Parsed {
  const yes = formatter.safeFormatBoolean(true, labels)
  const no = formatter.safeFormatBoolean(false, labels)
  if (!yes.success || !no.success) return fail('The boolean labels cannot be printed.')
  if (yes.value === no.value) return lost(`True and false both print "${yes.value}", so the value cannot be told apart.`)
  const match = matchLabelOf(raw, [{ value: true, label: yes.value }, { value: false, label: no.value }])
  if (!match) return fail(`The text is neither "${yes.value}" nor "${no.value}".`)
  return 'ambiguous' in match ? lost(`The text reads as both "${yes.value}" and "${no.value}", so the value cannot be told apart.`) : ok(match.value)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The extension label the formatter prints between a number and its extension. */
function extensionLabel(formatter: Formatter): string | undefined {
  const sample = '+12025550123'
  const result = formatter.safeFormatPhone({ number: sample, extension: '0' }, { style: 'e164' })
  return result.success ? result.value.slice(sample.length + 1, -2) : undefined
}

const E164 = /^\+[1-9]\d{1,14}$/

/** Read a phone number printed in a phone style back into E.164. */
function parsePhoneNumber(text: string, phone: LayerPhoneFormat): Parsed {
  const style = phone.style ?? 'e164'
  if ((style === 'national' || style === 'digits') && phone.region === undefined) {
    return lost(`A number printed as ${style} carries no country calling code; declare format.phone.region to read it back.`)
  }
  if (style === 'e164') {
    const number = text.replace(/[\s().-]/g, '')
    return E164.test(number) ? ok(number) : fail('The text is not an international phone number.')
  }
  const parsed = style === 'national' || style === 'digits' ? phoneProvider.parse(text, phone.region) : text.startsWith('+') ? phoneProvider.parse(text) : undefined
  return parsed ? ok(parsed.number) : fail(`The text is not a valid phone number written ${style}.`)
}

function parsePhone(raw: string, reader: Reader): Parsed {
  const phone = reader.phone!
  const text = raw.trim()
  const label = extensionLabel(reader.formatter)
  const extension = label ? text.match(new RegExp(`^(.*\\S)\\s+${escapeRegExp(label)}\\s+(\\S.*)$`, 'u')) : null
  const number = parsePhoneNumber(extension ? extension[1]! : text, phone)
  if (!number.ok) return number
  return ok({ number: number.value, ...(extension && { extension: extension[2] }) })
}

function parseFieldValue(raw: string, field: FormField, reader: Reader): Parsed {
  const { formatter } = reader
  if (composite.has(field.type)) {
    return fail(`A ${field.type} value written as one piece of text cannot be split back into its parts; bind its parts to recover it.`)
  }
  switch (field.type) {
    case 'text':
    case 'email':
    case 'uuid':
    case 'uri':
      return ok(raw)
    case 'enum': {
      const labelled = reader.choice === 'label' ? matchLabel(raw, field.enum, formatter) : undefined
      if (labelled) return labelled
      const option = matchOption(raw, field.enum, formatter)
      return option ? ok(option.value) : fail('The text matches none of the field\'s options.')
    }
    case 'multiselect': {
      const labelled = reader.choice === 'label' ? matchLabelList(raw, field.enum, formatter) : undefined
      if (labelled) return labelled
      // Fill joins the option values with ", "; a value may itself hold a comma.
      for (const parts of [raw.split(', '), raw.split(',')]) {
        const values = parts.map((part) => part.trim()).filter(Boolean)
        const options = values.map((value) => matchOption(value, field.enum, formatter))
        if (options.every((option) => option !== undefined)) return ok(options.map((option) => option!.value))
      }
      return fail('The selection includes a value that matches none of the field\'s options.')
    }
    case 'boolean': {
      if (reader.boolean && (reader.boolean.trueLabel !== undefined || reader.boolean.falseLabel !== undefined)) {
        return parseBooleanLabels(raw, reader.boolean, formatter)
      }
      const text = raw.trim()
      const yes = formatter.safeFormatBoolean(true)
      const no = formatter.safeFormatBoolean(false)
      if (yes.success && text === yes.value) return ok(true)
      if (no.success && text === no.value) return ok(false)
      const folded = text.toLowerCase()
      if (folded === 'true' || folded === 'yes') return ok(true)
      if (folded === 'false' || folded === 'no') return ok(false)
      return fail('The text is not a yes or no value.')
    }
    case 'number':
    case 'rating': {
      const value = parseNumber(raw, formatter.locale)
      return value === undefined ? fail('The text is not a number.') : ok(value)
    }
    case 'percentage': {
      const value = parseNumber(raw.trim().replace(/\s*%$/, ''), formatter.locale)
      return value === undefined ? fail('The text is not a percentage.') : ok(value)
    }
    case 'money':
      return parseMoney(raw, field, formatter)
    case 'date': {
      if (reader.date) {
        const value = parsePatternDate(raw, reader.date)
        return value === undefined ? fail(`The text is not a date written ${reader.date.pattern}.`) : ok(value)
      }
      const value = parseDate(raw, formatter.locale)
      return value === undefined ? fail('The text is not a date.') : ok(value)
    }
    case 'datetime': {
      const text = raw.trim()
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text) && !Number.isNaN(Date.parse(text))
        ? ok(text)
        : fail('Only an ISO 8601 date and time can be read back exactly.')
    }
    case 'time': {
      const value = parseTime(raw)
      return value === undefined ? fail('The text is not a time of day.') : ok(value)
    }
    case 'duration': {
      const text = raw.trim()
      return /^P(?!$)(\d+(\.\d+)?Y)?(\d+(\.\d+)?M)?(\d+(\.\d+)?W)?(\d+(\.\d+)?D)?(T(?=\d)(\d+(\.\d+)?H)?(\d+(\.\d+)?M)?(\d+(\.\d+)?S)?)?$/.test(text)
        ? ok(text)
        : fail('Only an ISO 8601 duration can be read back exactly.')
    }
    case 'country':
      return readCountry(raw, formatter)
    case 'region':
      return placeParsed(resolveRegion(raw, { ...(field.country !== undefined && { country: field.country }), regions: formatter.providers.regions }))
    case 'phone': {
      if (reader.phone?.style !== undefined) return parsePhone(raw, reader)
      const text = raw.trim().replace(/[\s().-]/g, '')
      return E164.test(text) ? ok({ number: text }) : fail('The text is not an international phone number.')
    }
  }
  return fail(`Values of type ${field.type} cannot be read back.`)
}

function parseTarget(raw: string, target: Target, reader: Reader): Parsed {
  if (target.kind === 'fixed') return fail(target.reason)
  if (target.kind === 'field') return parseFieldValue(raw, target.field, reader)
  if (target.type === 'number') {
    const value = parseNumber(raw, reader.formatter.locale)
    return value === undefined ? fail('The text is not a number.') : ok(value)
  }
  if (target.type === 'phoneNumber' && reader.phone?.style !== undefined) return parsePhoneNumber(raw.trim(), reader.phone)
  if (target.place?.member === 'country' && reader.country) return readCountry(raw, reader.formatter)
  return ok(raw)
}

// ---------------------------------------------------------------------------
// Reversing bindings
// ---------------------------------------------------------------------------

type Reading =
  | { kind: 'value'; value: unknown; lossy: boolean }
  | { kind: 'region'; raw: string; countryPath: string; formatter: Formatter }
  | { kind: 'empty' }
  | { kind: 'unparseable'; reason: string }
  | { kind: 'not_recoverable'; reason: string }

interface PathWork {
  sources: PdfExtractionSource[]
  readings: Reading[]
  /** Split parts by one-based position. */
  parts: Map<number, string | undefined>
  /** Checkbox-map options by qualifier: true when checked. */
  options: Map<string, boolean>
  optionKind?: 'enum' | 'multiselect'
  /** The reader of the first split part's binding, which reads the joined parts. */
  partsReader?: Reader
  /** The text of each value part a binding prints, such as a date's `year`; undefined for a bound field with no text. */
  valueParts: Map<ValuePart, string | undefined>
  /** The kind of value the parts are pieces of. */
  partKind?: string
}

function readingOf(parsed: Parsed): Reading {
  if (parsed.ok) return { kind: 'value', value: parsed.value, lossy: parsed.lossy }
  return parsed.lost ? { kind: 'not_recoverable', reason: parsed.reason } : { kind: 'unparseable', reason: parsed.reason }
}

function readRegions(readings: Reading[], countryOf: (path: string) => string | undefined): Reading[] {
  return readings.map((entry) => entry.kind === 'region' ? readingOf(readAddressRegion(entry.raw, countryOf(entry.countryPath), entry.formatter)) : entry)
}

function source(state: FieldState | undefined, name: string): PdfExtractionSource {
  return state?.raw === undefined ? { field: name } : { field: name, value: state.raw }
}

/** A radio button or dropdown holds export values, never the labels a text box prints. */
function exportValues(reader: Reader): Reader {
  const { choice: _choice, boolean: _boolean, ...values } = reader
  return values
}

function readDirect(state: FieldState, target: Target, reader: Reader): Reading {
  const { field } = state
  if (field.type === 'checkbox') {
    const isBoolean = target.kind === 'field' ? target.field.type === 'boolean' : false
    if (!isBoolean) {
      return state.on
        ? { kind: 'unparseable', reason: 'A checkbox can only be read back into a yes or no field.' }
        : { kind: 'empty' }
    }
    // An unchecked box cannot be told apart from an unanswered one.
    return state.on ? { kind: 'value', value: true, lossy: false } : { kind: 'empty' }
  }
  if (field.type === 'radio') {
    if (!state.on || state.raw === undefined) return { kind: 'empty' }
    const parsed = parseTarget(state.raw, target, exportValues(reader))
    return readingOf(parsed)
  }
  if (field.type === 'dropdown') {
    if (!state.selected || state.selected.length === 0) return { kind: 'empty' }
    const raw = state.selected.join(', ')
    const parsed = parseTarget(raw, target, exportValues(reader))
    return readingOf(parsed)
  }
  if (state.raw === undefined) return { kind: 'empty' }
  if (target.kind === 'fixed') return { kind: 'not_recoverable', reason: target.reason }
  if (target.kind === 'field' && composite.has(target.field.type)) {
    return { kind: 'not_recoverable', reason: `A ${target.field.type} value written as one piece of text cannot be split back into its parts; bind its parts to recover it.` }
  }
  if (target.kind === 'member' && target.place?.member === 'region' && reader.region) {
    return { kind: 'region', raw: state.raw, countryPath: target.place.countryPath, formatter: reader.formatter }
  }
  const parsed = parseTarget(state.raw, target, reader)
  return readingOf(parsed)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const notRecoverable = (reason: string): Reading => ({ kind: 'not_recoverable', reason })
const unparseable = (reason: string): Reading => ({ kind: 'unparseable', reason })
const recovered = (value: unknown): Reading => ({ kind: 'value', value, lossy: false })

function unboundParts(parts: ReadonlyMap<ValuePart, string | undefined>, needed: readonly ValuePart[], kind: string): Reading | undefined {
  const absent = needed.filter((part) => !parts.has(part))
  if (absent.length === 0) return undefined
  return notRecoverable(`A ${kind} is joined back only from all of ${needed.join(', ')}, and ${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} not bound.`)
}

function readDateParts(parts: ReadonlyMap<ValuePart, string | undefined>): Reading {
  const problem = unboundParts(parts, ['year', 'month', 'day'], 'date')
  if (problem) return problem
  const [year, month, day] = (['year', 'month', 'day'] as const).map((part) => parts.get(part)?.trim() ?? '')
  if (!/^\d{4}$/.test(year!) || !/^\d{1,2}$/.test(month!) || !/^\d{1,2}$/.test(day!)) {
    return unparseable('The date parts are not a four-digit year, and a month and day of one or two digits.')
  }
  const value = isoDate(Number(year), Number(month), Number(day))
  return value === undefined ? unparseable('The date parts name no calendar date.') : recovered(value)
}

function readMoneyParts(parts: ReadonlyMap<ValuePart, string | undefined>, target: Target): Reading {
  const problem = unboundParts(parts, ['units', 'cents'], 'money amount')
  if (problem) return problem
  const currency = target.kind === 'field' && target.field.type === 'money' ? target.field.currency : undefined
  if (currency === undefined) return notRecoverable('Money parts print no currency; declare the field\'s currency to read them back.')
  const units = parts.get('units')?.trim() ?? ''
  const cents = parts.get('cents')?.trim() ?? ''
  if (!/^\d+$/.test(units) || !/^\d{2}$/.test(cents)) return unparseable('The money parts are not whole units and two digits of cents.')
  return recovered({ amount: Number(`${units}.${cents}`), currency })
}

function readPhoneParts(parts: ReadonlyMap<ValuePart, string | undefined>): Reading {
  const split = parts.has('areaCode') && parts.has('subscriberNumber')
  if (!parts.has('nationalNumber') && !split) {
    return notRecoverable('A phone number is joined back only from its nationalNumber, or a +1 number\'s areaCode and subscriberNumber, and neither is bound.')
  }
  if (!parts.has('countryCode') && !split) return notRecoverable('A phone number is joined back only with its countryCode, which is not bound.')
  const text = (part: ValuePart) => parts.get(part)?.trim() ?? ''
  const national = parts.has('nationalNumber') ? text('nationalNumber') : `${text('areaCode')}${text('subscriberNumber')}`
  const countryCode = parts.has('countryCode') ? text('countryCode') : '1'
  if (!/^\d{1,3}$/.test(countryCode) || !/^\d+$/.test(national)) return unparseable('The phone parts are not a country calling code and a national number in digits.')
  const parsed = phoneProvider.parse(`+${countryCode}${national}`)
  if (!parsed) return unparseable(`+${countryCode}${national} is not a valid phone number.`)
  const northAmerican = parsed.countryCallingCode === '1' && parsed.nationalNumber.length === 10
  const printed: Partial<Record<ValuePart, string | undefined>> = {
    countryCode: parsed.countryCallingCode,
    nationalNumber: parsed.nationalNumber,
    areaCode: northAmerican ? parsed.nationalNumber.slice(0, 3) : undefined,
    subscriberNumber: northAmerican ? parsed.nationalNumber.slice(3) : undefined,
  }
  const conflicts = (['countryCode', 'nationalNumber', 'areaCode', 'subscriberNumber'] as const)
    .filter((part) => text(part) !== '' && text(part) !== printed[part])
  if (conflicts.length > 0) {
    return unparseable(`The phone parts do not agree: ${conflicts.join(' and ')} ${conflicts.length === 1 ? 'is' : 'are'} not what ${parsed.number} prints${!northAmerican && conflicts.some((part) => part === 'areaCode' || part === 'subscriberNumber') ? ', and areaCode and subscriberNumber exist only for +1 numbers' : ''}.`)
  }
  const extension = text('extension')
  return recovered({ number: parsed.number, ...(extension && { extension }) })
}

/**
 * Join value parts back into the value they are pieces of, only when every
 * part that holds it is bound: a date's year, month and day; a money
 * amount's units and cents, in the currency its field declares; a phone's
 * countryCode and nationalNumber, or a +1 number's areaCode and
 * subscriberNumber, with the extension when it is bound.
 */
function readValueParts(work: PathWork, target: Target): Reading | undefined {
  const parts = work.valueParts
  if (parts.size === 0) return undefined
  if ([...parts.values()].every((text) => text === undefined || text.trim() === '')) return { kind: 'empty' }
  if (target.kind === 'fixed') return notRecoverable(target.reason)
  if (work.partKind === 'date') return readDateParts(parts)
  if (work.partKind === 'money') return readMoneyParts(parts, target)
  if (work.partKind === 'phone') return readPhoneParts(parts)
  return notRecoverable(`A ${work.partKind ?? 'value'} has no parts to join back.`)
}

function resolvePath(work: PathWork, target: Target, reader: Reader): { status: PdfExtractionStatus; value?: unknown; reason?: string; lossy?: boolean } {
  const readings = [...work.readings]
  const joined = readValueParts(work, target)
  if (joined) readings.push(joined)

  if (work.parts.size > 0) {
    const positions = [...work.parts.keys()].sort((left, right) => left - right)
    const values = positions.map((position) => work.parts.get(position))
    const lastFilled = values.reduce<number>((last, value, index) => value === undefined ? last : index, -1)
    if (lastFilled === -1) readings.push({ kind: 'empty' })
    else if (positions.some((position, index) => position !== index + 1)) {
      readings.push({ kind: 'not_recoverable', reason: 'The split parts are not all bound, so the value cannot be joined back.' })
    }
    else if (values.slice(0, lastFilled).some((value) => value === undefined)) {
      readings.push({ kind: 'unparseable', reason: 'A part before the last filled part is empty, so the parts cannot be joined in order.' })
    } else {
      const parsed = parseTarget(values.slice(0, lastFilled + 1).join('-'), target, work.partsReader ?? reader)
      readings.push(readingOf(parsed))
    }
  }

  if (work.options.size > 0) {
    const checked = [...work.options].filter(([, on]) => on).map(([qualifier]) => qualifier)
    const declared = target.kind === 'field' && (target.field.type === 'enum' || target.field.type === 'multiselect') ? target.field.enum : []
    const valueOf = (qualifier: string) => declared.find((option) => String(option.value) === qualifier)?.value ?? qualifier
    if (checked.length === 0) readings.push({ kind: 'empty' })
    else if (work.optionKind === 'multiselect') readings.push({ kind: 'value', value: checked.map(valueOf), lossy: false })
    else if (checked.length === 1) readings.push({ kind: 'value', value: valueOf(checked[0]!), lossy: false })
    else readings.push({ kind: 'unparseable', reason: 'More than one option is checked for a field that takes one.' })
  }

  const problems = readings.filter((reading): reading is Extract<Reading, { kind: 'unparseable' }> => reading.kind === 'unparseable')
  if (problems.length > 0) return { status: 'unparseable', reason: problems.map((problem) => problem.reason).join(' ') }
  const values = readings.filter((reading): reading is Extract<Reading, { kind: 'value' }> => reading.kind === 'value')
  if (values.length > 0) {
    const [first] = values
    if (values.every((reading) => sameValue(reading.value, first!.value))) {
      return { status: 'recovered', value: first!.value, lossy: values.some((reading) => reading.lossy) }
    }
    return { status: 'unparseable', reason: 'The PDF fields that carry this path hold different values.' }
  }
  const lost = readings.find((reading): reading is Extract<Reading, { kind: 'not_recoverable' }> => reading.kind === 'not_recoverable')
  if (lost) return { status: 'not_recoverable', reason: lost.reason }
  return { status: 'empty' }
}

function setValue(root: Record<string, unknown>, segments: string[], value: unknown): void {
  let current: Record<string, unknown> | unknown[] = root
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index]!
    const nextIsIndex = /^\d+$/.test(segments[index + 1]!)
    const container = current as Record<string, unknown>
    if (container[key] === undefined || container[key] === null || typeof container[key] !== 'object') {
      container[key] = nextIsIndex ? [] : {}
    }
    current = container[key] as Record<string, unknown> | unknown[]
  }
  ;(current as Record<string, unknown>)[segments.at(-1)!] = value
}

function placeValue(data: PdfExtractedData, path: string, value: unknown): void {
  const segments = pathSegments(path)
  const [root, ...rest] = segments
  if (root === 'parties' && rest.length > 0) {
    data.parties ??= {}
    setValue(data.parties, rest, value)
    return
  }
  setValue(data.fields, segments, value)
}

/**
 * Read a filled PDF back into artifact data through the layer's bindings.
 *
 * Only exact reversals are returned: direct fields, split fields, checkbox and
 * radio maps. A joined binding's raw text is reported as not recoverable, and
 * text that does not parse into the field's type is reported with its raw
 * value. Nothing is validated here; pass the data to the normal fill path.
 *
 * @throws {PdfEncryptedError} when the PDF is encrypted.
 * @throws {PdfExtractionError} when the PDF or the layer choice cannot be read.
 */
export async function extractPdfData({ pdf, form, bindings, formatter: filledWith = defaultFormatter, format }: ExtractPdfDataOptions): Promise<PdfExtraction> {
  const readers = new Map<string, Reader>()
  const readerFor = (bindingFormat?: LayerFormat): Reader => {
    const effective = mergeFormats(format, bindingFormat)
    const key = JSON.stringify(effective ?? {})
    let found = readers.get(key)
    if (!found) {
      const localized = formatterFor(filledWith, effective)
      found = {
        formatter: effective?.money ? localized.compose({ money: effective.money }) : localized,
        ...(effective?.date && { date: effective.date }),
        ...(effective?.country && { country: effective.country }),
        ...(effective?.region && { region: effective.region }),
        ...(effective?.phone && { phone: effective.phone }),
        ...(effective?.choice?.display && { choice: effective.choice.display }),
        ...(effective?.boolean && { boolean: effective.boolean }),
      }
      readers.set(key, found)
    }
    return found
  }
  const reader = readerFor()
  const parsed = parseBindings(bindings)
  const sources = parsed.flatMap(({ parts }) => parts.map((part) => part.source))
  validateFieldBindings(form, Object.fromEntries(sources.map((source, index) => [String(index), source])))
  assertBindingFormats(form, parsed)

  const { model, fields, names } = await loadFormFields(pdf)
  const states = new Map(fields.map((field) => [field.name, readField(model, field)]))

  // Fill refuses a binding with no PDF field, so a PDF that lacks one was not
  // filled from this layer.
  const bindingNames = Object.keys(bindings)
  const missing = bindingNames.filter((name) => !names.has(name))
  if (missing.length === bindingNames.length) {
    throw new PdfExtractionError(
      'not_matching',
      `None of the PDF's ${fields.length} form fields match the layer's ${bindingNames.length} bindings. Check that the PDF is this artifact's form.`,
    )
  }
  if (missing.length > 0) {
    throw new PdfExtractionError(
      'not_matching',
      `The PDF has no field for ${missing.length} of the layer's ${bindingNames.length} bindings: ${missing.join(', ')}. Check that the PDF is this artifact's form.`,
    )
  }

  const work = new Map<string, PathWork>()
  const workFor = (path: string): PathWork => {
    let entry = work.get(path)
    if (!entry) {
      entry = { sources: [], readings: [], parts: new Map(), options: new Map(), valueParts: new Map() }
      work.set(path, entry)
    }
    return entry
  }

  for (const { field: pdfName, parts, format: bindingFormat, part: valuePart } of parsed) {
    const state = states.get(pdfName)
    const bindingReader = readerFor(bindingFormat)

    if (parts.length > 1) {
      for (const part of parts) {
        const entry = workFor(part.path)
        entry.sources.push(source(state, pdfName))
        entry.readings.push(state?.raw === undefined
          ? { kind: 'empty' }
          : { kind: 'not_recoverable', reason: 'Several values are joined into one PDF field, and extraction does not guess how to split them.' })
      }
      continue
    }

    const { path, qualifier } = parts[0]!
    const entry = workFor(path)
    entry.sources.push(source(state, pdfName))
    if (valuePart !== undefined) {
      const text = state?.raw
      const earlier = entry.valueParts.get(valuePart)
      if (earlier !== undefined && text !== undefined && earlier !== text) {
        entry.readings.push(unparseable(`The PDF fields that carry the part ${valuePart} hold different values.`))
      }
      entry.partKind ??= bindingDeclaration(form, path)?.kind
      entry.valueParts.set(valuePart, earlier ?? text)
      continue
    }
    const target = targetFor(form, path)
    const fieldType = target.kind === 'field' ? target.field.type : undefined
    const isPart = qualifier !== undefined && fieldType !== 'boolean' && fieldType !== 'enum' && fieldType !== 'multiselect' && splitPartIndex(qualifier) !== undefined
    if (!state) {
      // A bound field extraction cannot read (a signature or push button)
      // holds no value; a part still holds its place in the order.
      if (isPart) entry.parts.set(Number(qualifier), undefined)
      else entry.readings.push({ kind: 'empty' })
      continue
    }

    if (qualifier === undefined) {
      entry.readings.push(readDirect(state, target, bindingReader))
      continue
    }

    if (fieldType === 'boolean') {
      entry.readings.push(readDirect(state, target, bindingReader))
    } else if (fieldType === 'enum' || fieldType === 'multiselect') {
      entry.optionKind = fieldType
      entry.options.set(qualifier, state.field.type === 'checkbox' || state.field.type === 'radio'
        ? Boolean(state.on)
        : state.raw !== undefined)
    } else if (isPart) {
      entry.partsReader ??= bindingReader
      entry.parts.set(Number(qualifier), state.raw)
    } else {
      entry.readings.push(state.raw === undefined
        ? { kind: 'empty' }
        : { kind: 'not_recoverable', reason: `The qualifier "${qualifier}" has no reverse mapping for this field.` })
    }
  }

  const data: PdfExtractedData = { fields: {} }
  const entries: PdfExtractionEntry[] = []
  const resolvedPaths = new Map<string, ReturnType<typeof resolvePath>>()
  const resolve = (path: string, entry: PathWork) => {
    let resolved = resolvedPaths.get(path)
    if (!resolved) {
      resolved = resolvePath(entry, targetFor(form, path), reader)
      resolvedPaths.set(path, resolved)
    }
    return resolved
  }
  const countryOf = (path: string): string | undefined => {
    const entry = work.get(path)
    const resolved = entry && !entry.readings.some((item) => item.kind === 'region') ? resolve(path, entry) : undefined
    if (resolved?.status !== 'recovered' || typeof resolved.value !== 'string') return undefined
    const country = resolveCountry(resolved.value, { locale: reader.formatter.locale, regions: reader.formatter.providers.regions })
    return country.ok ? country.value : undefined
  }
  for (const entry of work.values()) entry.readings = readRegions(entry.readings, countryOf)
  for (const [path, entry] of work) {
    const resolved = resolve(path, entry)
    if (resolved.status === 'recovered') placeValue(data, path, resolved.value)
    entries.push({
      path,
      status: resolved.status,
      sources: entry.sources,
      ...(resolved.reason ? { reason: resolved.reason } : {}),
      ...(resolved.status === 'recovered' && { lossy: resolved.lossy ?? false }),
    })
  }

  const boundNames = new Set(Object.keys(bindings))
  const unbound: PdfUnboundField[] = []
  for (const state of states.values()) {
    if (boundNames.has(state.field.name)) continue
    const type = state.field.type
    if (type !== 'text' && type !== 'checkbox' && type !== 'radio' && type !== 'dropdown') continue
    const hasValue = type === 'checkbox' || type === 'radio' ? state.on : state.raw !== undefined
    if (hasValue && state.raw !== undefined) unbound.push({ field: state.field.name, type, value: state.raw })
  }

  return { data, report: { entries, unbound } }
}

/** A PDF layer as the artifact declares it. */
interface PdfLayerSpec {
  mimeType?: string
  bindings?: Bindings
  bindingsFrom?: string
  format?: LayerFormat
}

/**
 * Choose the PDF layer to read against: the named one, or the only PDF layer.
 * Returns its key, resolved bindings, and declared format.
 */
export function selectPdfExtractionLayer(
  layers: Record<string, PdfLayerSpec> | undefined,
  requested?: string,
): { key: string; bindings: Bindings; format?: LayerFormat } {
  const all = layers ?? {}
  const pdfKeys = Object.keys(all).filter((key) => all[key]?.mimeType?.toLowerCase() === 'application/pdf')
  let key = requested
  if (key !== undefined) {
    const layer = all[key]
    if (!layer) {
      throw new PdfExtractionError('layer_not_found', `Layer "${key}" not found. PDF layers: ${pdfKeys.join(', ') || '(none)'}.`)
    }
    if (layer.mimeType?.toLowerCase() !== 'application/pdf') {
      throw new PdfExtractionError('not_pdf_layer', `Layer "${key}" is ${layer.mimeType ?? 'not a PDF'}. PDF layers: ${pdfKeys.join(', ') || '(none)'}.`)
    }
  } else if (pdfKeys.length === 0) {
    throw new PdfExtractionError('no_pdf_layer', `The artifact has no PDF layer to read against. Layers: ${Object.keys(all).join(', ') || '(none)'}.`)
  } else if (pdfKeys.length > 1) {
    throw new PdfExtractionError('layer_required', `The artifact has several PDF layers; name one: ${pdfKeys.join(', ')}.`)
  } else {
    key = pdfKeys[0]!
  }
  const layer = all[key]!
  if (layer.bindingsFrom !== undefined && !layer.bindings && !all[layer.bindingsFrom]) {
    throw new PdfExtractionError(
      'unknown_bindings_source',
      `Layer "${key}" takes its bindings from "${layer.bindingsFrom}", which is not a layer. Layers: ${Object.keys(all).join(', ')}.`,
    )
  }
  const bindings = resolveLayerBindings(all, layer)
  if (!bindings || Object.keys(bindings).length === 0) {
    throw new PdfExtractionError('not_matching', `Layer "${key}" has no bindings, so no PDF field maps to the artifact.`)
  }
  // The format is the layer's own: a layer reusing another's bindings declares its own.
  return { key, bindings, ...(layer.format && { format: layer.format }) }
}

/** A layer format whose printed labels read-back cannot tell apart. */
export interface PdfLabelCollision {
  /** The PDF field the binding fills, or the field id a layer without bindings fills by. */
  field: string
  /** The artifact path whose labels collide. */
  path: string
  message: string
}

/** Options for {@link findPdfLabelCollisions}. */
export interface FindPdfLabelCollisionsOptions {
  form: Form
  /** The layer's bindings; without them, each field fills the PDF field of its own name. */
  bindings?: Bindings
  /** The layer's format, with each binding's own format merged over it. */
  format?: LayerFormat
  /** The formatter the layer is filled with. Defaults to the default formatter. */
  formatter?: Formatter
}

function labelCollisions(field: FormField, path: string, format: LayerFormat | undefined, formatter: Formatter): string[] {
  if ((field.type === 'enum' || field.type === 'multiselect') && format?.choice?.display === 'label') {
    const byLabel = new Map<string, { label: string; values: EnumOptionValue[] }>()
    for (const option of field.enum) {
      const label = optionLabel(option, field.enum, formatter)
      const group = byLabel.get(normalizedLabel(label)) ?? { label, values: [] }
      group.values.push(option.value)
      byLabel.set(normalizedLabel(label), group)
    }
    return [...byLabel.values()]
      .filter(({ values }) => values.length > 1)
      .map(({ label, values }) => `options ${values.map((value) => JSON.stringify(value)).join(', ')} of ${path} all print the label "${label}", apart from space and case, so reading the PDF back cannot tell them apart`)
  }
  if (field.type === 'boolean' && format?.boolean && (format.boolean.trueLabel !== undefined || format.boolean.falseLabel !== undefined)) {
    const yes = formatter.safeFormatBoolean(true, format.boolean)
    const no = formatter.safeFormatBoolean(false, format.boolean)
    if (yes.success && no.success && normalizedLabel(yes.value) === normalizedLabel(no.value)) {
      return [`true and false of ${path} print "${yes.value}" and "${no.value}", equal apart from space and case, so reading the PDF back cannot tell them apart`]
    }
  }
  return []
}

/**
 * Find the labels a PDF layer prints that read-back cannot tell apart: two
 * options of one choice field that print the same label under
 * `choice.display: label`, or `boolean` labels equal for true and false.
 * Filling still works; extraction reports such a value as not recoverable.
 */
export function findPdfLabelCollisions({ form, bindings, format, formatter = defaultFormatter }: FindPdfLabelCollisionsOptions): PdfLabelCollision[] {
  const targets = bindings
    ? parseBindings(bindings).flatMap(({ field, parts, format: bindingFormat }) =>
      parts.length === 1 && parts[0]!.qualifier === undefined ? [{ field, path: parts[0]!.path, format: mergeFormats(format, bindingFormat) }] : [])
    : Object.keys(form.fields ?? {}).map((name) => ({ field: name, path: name, format }))
  return targets.flatMap((target) => {
    const field = fieldDefinition(form, target.path)
    if (!field) return []
    return labelCollisions(field, `fields.${target.path}`, target.format, formatterFor(formatter, target.format))
      .map((message) => ({ field: target.field, path: `fields.${target.path}`, message }))
  })
}
