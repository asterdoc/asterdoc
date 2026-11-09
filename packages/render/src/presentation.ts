import type { Formatter, LayerFormat } from '@asterdoc/types'
import type { FieldFormattingOptions } from './text/field-formatter'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function definedEntries(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined))
}

/**
 * Merge formats from the lowest level to the highest: a layer's, then a
 * binding's. Each kind merges per property, so a binding's
 * `money: { currencyDisplay: 'none' }` keeps the layer's other money choices;
 * a scalar such as `locale` replaces the level below.
 */
export function mergeFormats(...levels: readonly (LayerFormat | undefined)[]): LayerFormat | undefined {
  let merged: Record<string, unknown> | undefined
  for (const level of levels) {
    if (!level) continue
    merged ??= {}
    for (const [kind, value] of Object.entries(level)) {
      if (value === undefined) continue
      const lower = merged[kind]
      merged[kind] = isRecord(value) ? { ...(isRecord(lower) ? lower : {}), ...definedEntries(value) } : value
    }
  }
  return merged as LayerFormat | undefined
}

/** The options of 0.11, which every renderer applied by preprocessing all values once. */
const LEGACY_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  money: ['currencyDisplay'],
  date: ['pattern'],
}

/**
 * Whether a format sets anything beyond `money.currencyDisplay` and
 * `date.pattern`. Only such a format needs values formatted one by one.
 */
export function hasNewFormatOptions(format: LayerFormat | undefined): boolean {
  if (!format) return false
  return Object.entries(format).some(([kind, value]) => {
    if (value === undefined) return false
    const legacy = LEGACY_OPTIONS[kind]
    return !legacy || !isRecord(value) || Object.keys(definedEntries(value)).some((key) => !legacy.includes(key))
  })
}

/** The field formatting options a format sets, over `base`. */
export function formatFieldOptions(format: LayerFormat | undefined, base: FieldFormattingOptions = {}): FieldFormattingOptions {
  return {
    ...base,
    ...(format?.money && { money: format.money }),
    ...(format?.date && { date: format.date }),
    ...(format?.phone && { phone: format.phone }),
    ...(format?.boolean && { boolean: format.boolean }),
    ...(format?.choice?.display && { choices: format.choice.display }),
  }
}

const composed = new WeakMap<Formatter, Map<string, Formatter>>()

/**
 * The formatter a format prints with: `formatter` itself, or one composed in
 * the format's `locale`. Composed formatters are kept per base formatter and
 * locale, so values formatted one by one share them.
 */
export function formatterFor(formatter: Formatter, format: LayerFormat | undefined): Formatter {
  const locale = format?.locale
  if (locale === undefined || locale === formatter.locale) return formatter
  let byLocale = composed.get(formatter)
  if (!byLocale) {
    byLocale = new Map()
    composed.set(formatter, byLocale)
  }
  let localized = byLocale.get(locale)
  if (!localized) {
    localized = formatter.compose({ locale })
    byLocale.set(locale, localized)
  }
  return localized
}
