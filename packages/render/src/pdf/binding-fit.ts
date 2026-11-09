/**
 * Authoring check that the values an artifact can bind to a PDF form's text
 * fields fit their boxes.
 *
 * Filling fails when a value cannot fit its box at {@link MIN_FONT_SIZE}, or
 * has more characters than a comb field has boxes. This check finds those
 * failures before any data exists: for each binding to an AcroForm text field
 * it builds values the bound artifact field accepts and lays them out with the
 * same code filling uses.
 *
 * A text, email, uuid, or uri field is checked at its length bound: `maxLength`
 * characters, or the length its `pattern` bounds (a uuid without a pattern
 * takes its 36-character canonical form). Two values of that length are laid out:
 * - a typical value: each open position holds the next character of
 *   {@link TYPICAL_TEXT}; a position the pattern constrains holds the allowed
 *   character nearest the allowed characters' mean width. When it cannot fit,
 *   ordinary answers fail to fill: an error.
 * - the widest value: each position holds the widest character it may hold
 *   (the widest Latin letter or digit when open, `W` in Helvetica). When only
 *   this value cannot fit, unusual answers fail to fill: a warning.
 *
 * A split binding (`path:2`) takes the matching hyphen-separated part of the
 * pattern, or the whole value's bound when the pattern does not fix the parts.
 * Enum and multiselect fields write known option values, so they are checked
 * exactly: the option value widest in glyphs and the one longest in
 * characters, or for each selection size up to `max` (all of them without
 * `max`) the widest and the longest values joined with ", ". Under
 * `choice.display: label` the labels are measured instead, a multiselect's
 * joined as the formatter lists them. A boolean under `boolean` labels is
 * checked exactly at both labels. A phone under a `phone.style` is checked at
 * the longest number the style prints, every digit the widest digit: in
 * `phone.region`'s plan under `national` and `digits`, in any plan under
 * `international` and `e164`; a whole phone adds the extension label and an
 * extension of the longest length the phone value allows. A comma-joined
 * binding joins each path's value with ", ". More characters than a comb field
 * has boxes is an error.
 *
 * The font is the one filling would choose: the layer's declared font, then
 * the form's own font for the field, then Helvetica. A font supplied only at
 * render time is not known here.
 */

import { COUNTRY_CODES, countryName, displayRegion, subdivisionsOf } from '@asterdoc/format'
import type { BindingValue, Bindings, EnumOption, Form, FormField, Formatter, LayerFormat } from '@asterdoc/types'
import { acroFields, textFieldDrawing, widgetLayout, type AcroField } from './acroform'
import { PdfFontSet, type PdfFont } from './drawing-fonts'
import { layoutFieldText, MIN_FONT_SIZE, PdfFieldFillError, type FieldLayout } from './field-appearance'
import { analyzePattern, REFERENCE_REPERTOIRE, type CharSet } from './pattern-bounds'
import { parseBinding, splitPartIndex, type PdfBindingPart } from '../layer-bindings'
import { fieldDefinition } from '../layer-bindings'
import { PdfModel } from './syntax'
import { defaultFormatter } from '../default-formatter'
import { formatterFor, mergeFormats } from '../presentation'
import { pathSegments } from '../path'

/**
 * The text a typical value is made of: an English pangram with its word spaces,
 * repeated. It holds every lowercase letter, one capital, and spaces at about
 * the rate English prose has them, so its mean advance (456 units in Helvetica)
 * sits just above that of letter-frequency-weighted English text (441).
 */
export const TYPICAL_TEXT = 'The quick brown fox jumps over the lazy dog '

/** Why a binding may not fit its PDF text field. */
export type PdfBindingFitReason = 'overflow' | 'comb-length' | 'unbounded'

/** One binding whose values may not fit the PDF text field it fills. */
export interface PdfBindingFitIssue {
  /** Fully qualified name of the PDF form field. */
  field: string
  /** The binding's path text as the layer declares it: the string binding, or a binding object's `path`. */
  binding: string
  /** The artifact paths the binding reads, such as `fields.amountSource`. */
  paths: string[]
  /**
   * `error` when a typical value, an option value, or a value's length cannot
   * be filled; `warning` when only the widest value overflows, or nothing
   * bounds the value.
   */
  severity: 'error' | 'warning'
  reason: PdfBindingFitReason
  /** Which value failed: a typical one, or the widest. Absent for `unbounded`. */
  value?: 'typical' | 'widest'
  /** For `overflow`, the minimum font size in points; for `comb-length`, the number of comb boxes. */
  limit?: number
  /** Characters in the widest value checked. */
  length?: number
  message: string
}

/** Options for {@link checkPdfBindingFit}. */
export interface CheckPdfBindingFitOptions {
  /** The PDF layer's bytes. */
  template: Uint8Array
  form: Form
  /** The layer's bindings, strings or binding objects; without them, fields fill the PDF fields of the same name. */
  bindings?: Bindings
  /** The font the layer declares. */
  layerFont?: PdfFont
  /** How the layer prints values, with each binding's own format merged over it. */
  format?: LayerFormat
  /** The formatter the layer is filled with, which prints labels. Defaults to the default formatter. */
  formatter?: Formatter
}

const TEXT_TYPES = new Set(['text', 'email', 'uuid', 'uri'])
const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
const ANY: CharSet = { any: true }

/** The font a value is measured in: the metrics filling uses, and which characters it can draw. */
interface MeasuringFont {
  width(text: string): number
  covers(text: string): boolean
}

type ValueKind = 'typical' | 'widest'

/** The values one bound path accepts at its length bound, built for a font. */
interface BoundSource {
  path: string
  /** Every character the value may hold, used to choose the font. */
  probe: string
  /** What bounds the value, such as `maxLength 200`. */
  basis: string
  /**
   * The candidate with the most characters, when it can differ from the
   * widest: a comb holds characters, not width, so both are checked.
   */
  longest?: (font: MeasuringFont) => string
  /** True when the value is one of known option values, so typical and widest are one check. */
  exact: boolean
  value(font: MeasuringFont, kind: ValueKind): string
}

type SourceAnalysis =
  | { kind: 'bounded'; source: BoundSource }
  | { kind: 'unbounded'; path: string }
  | { kind: 'other' }

/** Longest widest value a message quotes in full. */
const SHOWN_LENGTH = 40
const format = (value: number) => String(Number(value.toFixed(3)))
const displayPath = (path: string) => `fields.${path}`

function widestCharacter(font: MeasuringFont, sets: CharSet[]): string {
  const pool = sets.some((item) => item.any)
    ? [...new Set([...REFERENCE_REPERTOIRE, ...sets.flatMap((item) => item.any ? [] : item.chars)])]
    : [...new Set(sets.flatMap((item) => item.any ? [] : item.chars))]
  const drawable = pool.filter((character) => font.covers(character))
  const candidates = drawable.length > 0 ? drawable : pool
  return candidates.reduce((best, character) => measure(font, character) > measure(font, best) ? character : best, candidates[0] ?? 'W')
}

/** The allowed character nearest the allowed characters' mean width, or the typical text's character when it is allowed. */
function typicalCharacter(font: MeasuringFont, set: CharSet, position: number): string {
  const sample = TYPICAL_TEXT[position % TYPICAL_TEXT.length]!
  if (set.any || set.chars.includes(sample)) return sample
  const drawable = set.chars.filter((character) => font.covers(character))
  const pool = drawable.length > 0 ? drawable : set.chars
  const mean = pool.reduce((total, character) => total + measure(font, character), 0) / pool.length
  return pool.reduce((best, character) =>
    Math.abs(measure(font, character) - mean) < Math.abs(measure(font, best) - mean) ? character : best, pool[0]!)
}

function picker(font: MeasuringFont, kind: ValueKind): (set: CharSet, position: number) => string {
  return kind === 'widest'
    ? (set) => widestCharacter(font, [set])
    : (set, position) => typicalCharacter(font, set, position)
}

/** One set holding every character any of `sets` allows. */
function unionSet(sets: CharSet[]): CharSet {
  return sets.some((item) => item.any) ? ANY : { any: false, chars: [...new Set(sets.flatMap((item) => item.any ? [] : item.chars))] }
}

function measure(font: MeasuringFont, text: string): number {
  return font.covers(text) ? font.width(text) : 0
}

function probeOf(sets: CharSet[]): string {
  const chars = new Set(sets.flatMap((item) => item.any ? REFERENCE_REPERTOIRE : item.chars))
  return [...chars].join('')
}

function textSource(path: string, field: FormField & { maxLength?: number; pattern?: string }, part?: number): SourceAnalysis {
  const declared = field.pattern ?? (field.type === 'uuid' ? UUID_PATTERN : undefined)
  const analysis = declared === undefined ? undefined : analyzePattern(declared)
  const shapeFor = (font: MeasuringFont, kind: ValueKind) => {
    const width = (text: string) => measure(font, text)
    const pick = picker(font, kind)
    return part === undefined ? analysis?.shape(width, pick) : analysis?.part(part, width, pick)
  }
  const lengthOnly: MeasuringFont = { width: (text) => text.length, covers: () => true }
  const shape = shapeFor(lengthOnly, 'widest')
  const maxLength = Math.min(field.maxLength ?? Infinity, shape?.maxLength ?? Infinity)
  if (maxLength === Infinity) return { kind: 'unbounded', path }
  const sets = shape?.sets ?? analysis?.sets() ?? [ANY]
  const byPattern = shape !== undefined && shape.value !== undefined && (field.maxLength === undefined || shape.maxLength <= field.maxLength)
  const partLabel = part === undefined ? '' : ` (part ${part + 1})`
  const basis = byPattern ? `pattern ${declared}${partLabel}` : `maxLength ${field.maxLength}${partLabel}`
  return {
    kind: 'bounded',
    source: {
      path,
      probe: probeOf(sets),
      basis,
      exact: false,
      value(font, kind) {
        const measured = shapeFor(font, kind)
        if (byPattern && measured?.value !== undefined) return measured.value
        const pick = picker(font, kind)
        const set = unionSet(sets)
        return Array.from({ length: maxLength }, (_, position) => pick(set, position)).join('')
      },
    },
  }
}

const DIGITS: CharSet = { any: false, chars: [...'0123456789'] }

/** Every candidate is printed in full, so the widest is checked exactly. */
function widest(font: MeasuringFont, candidates: readonly string[]): string {
  return candidates.reduce((best, candidate) => measure(font, candidate) > measure(font, best) ? candidate : best, candidates[0] ?? '')
}

function longestOf(candidates: readonly string[]): string {
  return candidates.reduce((best, candidate) => [...candidate].length > [...best].length ? candidate : best, candidates[0] ?? '')
}

/**
 * Every printed value is known: the widest of `printedFor(font)` by glyph
 * width, and the longest by characters, are each checked.
 */
function listedSource(path: string, probe: readonly string[], basis: string, printedFor: (font: MeasuringFont) => readonly string[]): SourceAnalysis {
  if (probe.length === 0) return { kind: 'other' }
  return {
    kind: 'bounded',
    source: {
      path,
      probe: probe.join(''),
      basis,
      exact: true,
      value: (font) => widest(font, printedFor(font)),
      longest: (font) => longestOf(printedFor(font)),
    },
  }
}

/**
 * The selections of up to `count` options that print widest and longest: for
 * each size, the options widest by glyph width and the options longest by
 * characters, each printed as `join` prints them.
 */
function selections<T>(options: readonly T[], count: number, text: (option: T) => string, font: MeasuringFont, join: (chosen: T[]) => string): string[] {
  const byWidth = [...options].sort((left, right) => measure(font, text(right)) - measure(font, text(left)))
  const byLength = [...options].sort((left, right) => [...text(right)].length - [...text(left)].length)
  const printed: string[] = []
  for (let size = 1; size <= count; size++) printed.push(join(byWidth.slice(0, size)), join(byLength.slice(0, size)))
  return printed
}

function printed(result: ReturnType<Formatter['safeFormatEnum']>): string | undefined {
  return result.success ? result.value : undefined
}

function labelSource(path: string, field: FormField & { enum: readonly EnumOption[] }, formatter: Formatter): SourceAnalysis {
  const options = field.enum
  const labels = options.map((option) => printed(formatter.safeFormatEnum(option.value, { options })))
  if (labels.some((label) => label === undefined)) return { kind: 'other' }
  const byValue = new Map(options.map((option, index) => [option.value, labels[index]!]))
  if (field.type === 'enum') return listedSource(path, labels as string[], 'its option labels', () => labels as string[])
  const count = Math.min(field.type === 'multiselect' ? field.max ?? options.length : 1, options.length)
  const join = (chosen: EnumOption[]) => {
    const values = chosen.map((option) => option.value)
    return printed(formatter.safeFormatMultiselect(values, { options })) ?? values.map((value) => byValue.get(value)!).join(', ')
  }
  return listedSource(path, labels as string[], count === options.length ? 'all its option labels' : `up to ${count} of its option labels`, (font) =>
    selections(options, count, (option) => byValue.get(option.value)!, font, join))
}

function booleanSource(path: string, format: LayerFormat | undefined, formatter: Formatter): SourceAnalysis {
  if (format?.boolean?.trueLabel === undefined && format?.boolean?.falseLabel === undefined) return { kind: 'other' }
  const labels = [true, false].map((value) => printed(formatter.safeFormatBoolean(value, format.boolean)))
  if (labels.some((label) => label === undefined)) return { kind: 'other' }
  return listedSource(path, labels as string[], 'its boolean labels', () => labels as string[])
}

const EXTENSION_MAX_LENGTH = 20

/** What a whole phone prints after its number at most: the formatter's extension label and the longest extension, every digit written 0. */
function extensionShape(formatter: Formatter): string | undefined {
  const sample = '+12025550123'
  const result = formatter.safeFormatPhone({ number: sample, extension: '0'.repeat(EXTENSION_MAX_LENGTH) }, { style: 'e164' })
  return result.success ? result.value.slice(sample.length).replace(/\d/g, '0') : undefined
}

/**
 * A phone under a style prints at most its plan's longest number: `region`'s
 * plan under `national` and `digits`, which refuse another calling code, and
 * any plan under `international` and `e164`, which print one. A whole phone
 * adds its extension; a `number` member does not.
 */
function phoneSource(path: string, format: LayerFormat | undefined, formatter: Formatter, withExtension: boolean): SourceAnalysis {
  const style = format?.phone?.style
  if (style === undefined) return { kind: 'other' }
  const region = style === 'national' || style === 'digits' ? format?.phone?.region : undefined
  const number = style === 'e164' ? `+${'0'.repeat(15)}` : formatter.providers.phone?.longest(style, region)
  const extension = withExtension ? extensionShape(formatter) : ''
  if (!number || extension === undefined) return { kind: 'other' }
  const shape = `${number}${extension}`
  const plan = style === 'e164' ? 'any E.164 number' : region === undefined ? 'any numbering plan' : `the ${region} numbering plan`
  return {
    kind: 'bounded',
    source: {
      path,
      probe: `${shape.replace(/0/g, '')}0123456789`,
      basis: `phone style ${style} for ${plan}${withExtension ? `, with an extension of ${EXTENSION_MAX_LENGTH} digits` : ''}`,
      exact: true,
      value: (font) => shape.replace(/0/g, widestCharacter(font, [DIGITS])),
    },
  }
}

function choiceSource(path: string, field: FormField, format?: LayerFormat, formatter: Formatter = defaultFormatter): SourceAnalysis {
  if (field.type === 'boolean') return booleanSource(path, format, formatter)
  if (field.type === 'phone') return phoneSource(path, format, formatter, true)
  if (field.type !== 'enum' && field.type !== 'multiselect') return { kind: 'other' }
  if (format?.choice?.display === 'label') return labelSource(path, field, formatter)
  const values = field.enum.map((option) => String(option.value))
  const count = field.type === 'multiselect' ? Math.min(field.max ?? values.length, values.length) : 1
  const basis = field.type === 'enum' ? 'its widest option value' : count === values.length ? 'all its option values' : `its ${count} widest option values`
  return listedSource(path, values, basis, (font) => selections(values, count, (value) => value, font, (chosen) => chosen.join(', ')))
}

/** The phone field a `phone.number` member path reads, which prints as the phone's number. */
function phoneNumberMember(form: Form, path: string): FormField | undefined {
  if (!path.endsWith('.number')) return undefined
  const parent = fieldDefinition(form, path.slice(0, -'.number'.length))
  return parent?.type === 'phone' ? parent : undefined
}

function countrySource(path: string, display: 'code' | 'name', formatter: Formatter): SourceAnalysis {
  const codes = Object.keys(COUNTRY_CODES)
  const printed = display === 'name' ? codes.map((code) => countryName(code, formatter.locale)) : codes
  return listedSource(path, printed, display === 'name' ? `every country name in ${formatter.locale}` : 'every country code', () => printed)
}

function regionSource(path: string, country: string | undefined, display: 'code' | 'name' | 'full', formatter: Formatter): SourceAnalysis {
  const regions = formatter.providers.regions
  if (!regions) return { kind: 'other' }
  const pool = country === undefined ? regions.subdivisions : subdivisionsOf(country, regions)
  const printed = pool.map((subdivision) => displayRegion(subdivision.code, display, regions))
  const noun = { code: 'code', name: 'name', full: 'full code' }[display]
  return listedSource(path, printed, `every subdivision ${noun}${country === undefined ? '' : ` of ${country}`}`, () => printed)
}

function addressMemberSource(form: Form, path: string, format: LayerFormat | undefined, formatter: Formatter): SourceAnalysis {
  const segments = pathSegments(path)
  const member = segments.at(-1)
  if (fieldDefinition(form, segments.slice(0, -1).join('.'))?.type !== 'address') return { kind: 'other' }
  if (member === 'country' && format?.country) return countrySource(path, format.country.display, formatter)
  if (member === 'region' && format?.region) return regionSource(path, undefined, format.region.display, formatter)
  return { kind: 'other' }
}

/** What one binding path fills a text field with. */
function analyzeSource(form: Form, { path, qualifier }: PdfBindingPart, format: LayerFormat | undefined, formatter: Formatter): SourceAnalysis {
  const field = fieldDefinition(form, path)
  if (!field) {
    if (qualifier !== undefined) return { kind: 'other' }
    const phone = phoneNumberMember(form, path)
    return phone ? phoneSource(path, format, formatter, false) : addressMemberSource(form, path, format, formatter)
  }
  if (qualifier === undefined && field.type === 'country') return countrySource(path, format?.country?.display ?? 'code', formatter)
  if (qualifier === undefined && field.type === 'region') return regionSource(path, field.country, format?.region?.display ?? 'full', formatter)
  if (qualifier !== undefined) {
    // A qualifier on a boolean, choice, or list field tests a value, which fills a checkbox.
    if (!TEXT_TYPES.has(field.type)) return { kind: 'other' }
    const part = splitPartIndex(qualifier)
    return part === undefined ? { kind: 'other' } : textSource(path, field as FormField & { maxLength?: number }, part)
  }
  if (TEXT_TYPES.has(field.type)) return textSource(path, field as FormField & { maxLength?: number })
  return choiceSource(path, field, format, formatter)
}

/** The binding's path text and the sources it reads, or undefined when it is not checked. */
function analyzeBinding(form: Form, value: BindingValue, format: LayerFormat | undefined, formatter: Formatter): { binding: string; sources: SourceAnalysis[] } | undefined {
  const parsed = parseBinding(value)
  const effective = mergeFormats(format, parsed.format)
  const localized = formatterFor(formatter, effective)
  const sources = parsed.parts.map((part) => analyzeSource(form, part, effective, localized))
  // A joined value is checked only when every part is known.
  if (sources.some((source) => source.kind === 'other')) return undefined
  return { binding: parsed.path, sources }
}

function describe(layout: FieldLayout): string {
  return `${format(layout.width)} × ${format(layout.height)} pt box`
}

function fitFailure(field: AcroField, binding: string, sources: BoundSource[], layout: FieldLayout, text: string, kind: ValueKind, error: PdfFieldFillError): PdfBindingFitIssue | undefined {
  if (error.reason !== 'overflow' && error.reason !== 'comb-length') return undefined
  const length = [...text].length
  const paths = sources.map((source) => displayPath(source.path))
  const shown = length <= SHOWN_LENGTH ? `: "${text}"` : ''
  const exact = sources.every((source) => source.exact)
  const adjective = exact || error.reason === 'comb-length' ? 'longest' : kind
  const what = sources.length === 1
    ? `the ${adjective} value ${paths[0]} accepts under ${sources[0]!.basis} (${length} characters${shown})`
    : `the ${adjective} joined value of ${paths.join(', ')} (${length} characters)`
  const message = error.reason === 'comb-length'
    ? `${what} has more characters than the field's ${error.limit} comb boxes`
    : `${what} does not fit the ${describe(layout)} at the minimum size of ${format(error.limit ?? MIN_FONT_SIZE)} pt` +
      (kind === 'widest' ? '; a typical value fits, but one made mostly of wide letters such as W does not' : '')
  return {
    field: field.name,
    binding,
    paths,
    severity: kind === 'typical' ? 'error' : 'warning',
    reason: error.reason,
    value: kind,
    ...(error.limit !== undefined && { limit: error.limit }),
    length,
    message,
  }
}

/**
 * Check that every value the artifact accepts for a binding to a PDF text
 * field can be filled: that it fits the box at the minimum font size, and
 * that it has no more characters than a comb field has boxes. A text field
 * with nothing bounding its length is a warning. A PDF without an AcroForm
 * has nothing to check.
 *
 * @throws {PdfFontError} when the layer's font cannot be read.
 * @throws {PdfBindingSyntaxError} when a binding cannot be parsed.
 */
export async function checkPdfBindingFit({ template, form, bindings, layerFont, format, formatter = defaultFormatter }: CheckPdfBindingFitOptions): Promise<PdfBindingFitIssue[]> {
  const model = await PdfModel.load(template)
  const acro = acroFields(model)
  if (!acro) return []
  const fonts = PdfFontSet.create(model, { layerFont })
  await fonts.readFormFonts(model.dict(acro.acroForm.entries.get('DR')))
  const byName = new Map(acro.fields.map((field) => [field.name, field]))
  const entries: [string, BindingValue][] = bindings
    ? Object.entries(bindings)
    : Object.entries(form.fields ?? {}).filter(([, field]) => field.type !== 'fieldset').map(([name]) => [name, name])

  const issues: PdfBindingFitIssue[] = []
  for (const [name, value] of entries) {
    const field = byName.get(name)
    if (!field || field.type !== 'text') continue
    const analysis = analyzeBinding(form, value, format, formatter)
    if (!analysis) continue
    const { binding, sources: analyzed } = analysis
    const drawing = textFieldDrawing(field)
    const layouts = field.widgets
      .map((widget) => widgetLayout(model, field, widget, drawing))
      .filter((layout): layout is NonNullable<typeof layout> => layout !== undefined)
    if (layouts.length === 0) continue

    const unbounded = analyzed.filter((source): source is Extract<SourceAnalysis, { kind: 'unbounded' }> => source.kind === 'unbounded')
    if (unbounded.length > 0) {
      const paths = unbounded.map((source) => displayPath(source.path))
      issues.push({
        field: field.name,
        binding,
        paths,
        severity: 'warning',
        reason: 'unbounded',
        message: `${paths.join(', ')} has no maxLength or pattern that bounds its length, so a long value can fail to fill the ${describe(layouts[0]!)}${drawing.comb ? ` with ${drawing.comb} comb boxes` : ''}`,
      })
      continue
    }

    const sources = analyzed.map((source) => (source as Extract<SourceAnalysis, { kind: 'bounded' }>).source)
    for (const layout of layouts) {
      const issue = checkLayout(fonts, field, binding, sources, layout)
      if (issue) {
        issues.push(issue)
        break
      }
    }
  }
  return issues
}

function checkLayout(fonts: PdfFontSet, field: AcroField, binding: string, sources: BoundSource[], layout: FieldLayout & { appearance: { fontName?: string } }): PdfBindingFitIssue | undefined {
  let chosen: MeasuringFont
  try {
    chosen = fonts.select(field.name, sources.map((source) => source.probe).join(''), layout.appearance.fontName)
  } catch (error) {
    // Characters no font can draw are a font question, not a fit question.
    if (error instanceof PdfFieldFillError) return undefined
    throw error
  }
  const exact = sources.every((source) => source.exact)
  const checks: { kind: ValueKind; text: string }[] = [
    { kind: 'typical', text: sources.map((source) => source.value(chosen, 'typical')).join(', ') },
    ...(exact ? [] : [{ kind: 'widest' as const, text: sources.map((source) => source.value(chosen, 'widest')).join(', ') }]),
  ]
  if (sources.some((source) => source.longest)) {
    checks.push({ kind: exact ? 'typical' : 'widest', text: sources.map((source) => source.longest?.(chosen) ?? source.value(chosen, 'widest')).join(', ') })
  }
  for (const { kind, text } of checks) {
    try {
      layoutFieldText(layout, text, fonts.select(field.name, text, layout.appearance.fontName))
    } catch (error) {
      if (!(error instanceof PdfFieldFillError)) throw error
      return fitFailure(field, binding, sources, layout, text, kind, error)
    }
  }
  return undefined
}
