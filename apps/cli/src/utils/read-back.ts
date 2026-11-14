import type { FormExtraction } from '@asterdoc/core'

import type { FilledPayload } from './validate-data.js'

/** One value the PDF holds that is not the value the data gives. */
export interface ReadBackDifference {
  path: string
  given: unknown
  read: unknown
}

/** A filled PDF compared with the data it was rendered from. */
export interface ReadBack {
  /** Values the data gives that the PDF holds, read back equal */
  equal: number
  /** Values the PDF holds that are not what the data gives */
  differ: ReadBackDifference[]
  /** Paths the data gives a value for whose boxes are empty */
  notPrinted: string[]
  /** Paths whose boxes hold text that cannot be read as a value, each with the reason */
  unreadable: Array<{ path: string; reason: string }>
  /** Paths the data gives a value for that print in a form that does not read back as one value, each with the text its boxes hold */
  notCompared: Array<{ path: string; holds: string[] }>
}

function segmentsOf(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((segment) => segment !== '')
}

function valueAt(payload: { fields?: unknown; parties?: unknown }, path: string): unknown {
  const segments = segmentsOf(path)
  const inParties = segments[0] === 'parties' && segments.length > 1
  let current: unknown = inParties ? payload.parties : payload.fields
  for (const segment of inParties ? segments.slice(1) : segments) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function isGiven(value: unknown): boolean {
  if (value === undefined || value === null || value === '' || value === false) return false
  return !(Array.isArray(value) && value.length === 0)
}

function same(given: unknown, read: unknown, lossy: boolean): boolean {
  if (typeof given === 'string' && typeof read === 'string') return lossy ? given.toLocaleLowerCase() === read.toLocaleLowerCase() : given === read
  if (Array.isArray(given) && Array.isArray(read)) return given.length === read.length && given.every((item, index) => same(item, read[index], lossy))
  if (given !== null && read !== null && typeof given === 'object' && typeof read === 'object') {
    const left = given as Record<string, unknown>
    const right = read as Record<string, unknown>
    return Object.keys(right).every((key) => same(left[key], right[key], lossy))
  }
  return given === read
}

/**
 * Compare what a filled PDF holds with the data it was rendered from, one
 * binding target at a time. A value the form computes or defaults is not in
 * the data, so it is not compared. A `false` the data gives prints as an empty
 * box, so an empty box for it is not a fault.
 */
export function readBack(extraction: FormExtraction, data: FilledPayload): ReadBack {
  const result: ReadBack = { equal: 0, differ: [], notPrinted: [], unreadable: [], notCompared: [] }
  for (const entry of extraction.report.entries) {
    const given = valueAt(data, entry.path)
    if (entry.status === 'unparseable') {
      result.unreadable.push({ path: entry.path, reason: entry.reason ?? 'The box holds text that is not a value of this field.' })
    } else if (entry.status === 'recovered') {
      if (given === undefined || given === null) continue
      const read = valueAt(extraction.data, entry.path)
      if (same(given, read, entry.lossy === true)) result.equal += 1
      else result.differ.push({ path: entry.path, given, read })
    } else if (isGiven(given)) {
      if (entry.status === 'empty') result.notPrinted.push(entry.path)
      else result.notCompared.push({ path: entry.path, holds: entry.sources.flatMap((source) => (source.value === undefined ? [] : [source.value])) })
    }
  }
  return result
}

function count(total: number, one: string, many: string): string {
  return `${total} ${total === 1 ? one : many}`
}

/** True when the PDF holds every value the data gives that can be compared. */
export function readBackPasses(result: ReadBack): boolean {
  return result.differ.length === 0 && result.notPrinted.length === 0 && result.unreadable.length === 0
}

/** The lines a filler reads: the verdict first, then each fault, then what was not compared. */
export function readBackLines(file: string, result: ReadBack): string[] {
  const faults = [
    ...(result.differ.length > 0 ? [count(result.differ.length, 'differs', 'differ')] : []),
    ...(result.notPrinted.length > 0 ? [count(result.notPrinted.length, 'did not print', 'did not print')] : []),
    ...(result.unreadable.length > 0 ? [count(result.unreadable.length, 'cannot be read', 'cannot be read')] : []),
  ]
  const lines = [`Read back from ${file}: ${count(result.equal, 'value equals', 'values equal')} the data${faults.length > 0 ? `, ${faults.join(', ')}` : ''}.`]
  if (result.differ.length > 0) {
    lines.push('  Differ (the data has one value, the PDF holds another):')
    for (const item of result.differ) lines.push(`    - ${item.path}: data ${JSON.stringify(item.given)}, PDF ${JSON.stringify(item.read)}`)
  }
  if (result.notPrinted.length > 0) {
    lines.push('  Did not print (the data has a value, the box is empty):')
    for (const path of result.notPrinted) lines.push(`    - ${path}`)
  }
  if (result.unreadable.length > 0) {
    lines.push('  Cannot be read (the box holds text that is not a value of the field):')
    for (const item of result.unreadable) lines.push(`    - ${item.path}: ${item.reason}`)
  }
  if (result.notCompared.length > 0) {
    lines.push(`  Not compared (${result.notCompared.length}): ${result.notCompared.length === 1 ? 'it prints' : 'each one prints'} in a form that does not read back as one value. This is not a fault.`)
    for (const item of result.notCompared) lines.push(`    - ${item.path}: ${item.holds.length === 0 ? 'the box is empty' : `the PDF holds ${item.holds.map((text) => JSON.stringify(text)).join(' and ')}`}`)
  }
  return lines
}
