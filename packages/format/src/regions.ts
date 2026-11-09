/**
 * @asterdoc/format/regions
 *
 * English ISO 3166-2 subdivision names from the Unicode CLDR, for region
 * lookup and display. Data: `cldr-subdivisions-full` (names) and `cldr-core`
 * (`subdivisionContainment`, which lists the current subdivision codes), both
 * CLDR 49. See notices/cldr-Unicode-3.0.txt for the Unicode License.
 */

import aliasesFile from 'cldr-core/supplemental/aliases.json'
import containmentFile from 'cldr-core/supplemental/subdivisionContainment.json'
import namesFile from 'cldr-subdivisions-full/subdivisions/en/en.json'

import type { RegionsProvider, Subdivision } from './places'

export type { PlaceCandidate, PlaceIssueCode, RegionsProvider, Subdivision } from './places'

/** The CLDR release the subdivision data comes from. */
export const CLDR_VERSION = '49'

const names: Readonly<Record<string, string>> = namesFile.subdivisions.localeDisplayNames.subdivisions
const containment: Readonly<Record<string, { readonly _contains: readonly string[] }>> =
	containmentFile.supplemental.subdivisionContainment

const subdivisionAliases: Readonly<Record<string, { readonly _replacement: string }>> =
	aliasesFile.supplemental.metadata.alias.subdivisionAlias

/**
 * The CLDR id an alias names its subdivision by: a subdivision id it is
 * replaced by, or, for an alias replaced by a region code (`cn91` by `HK`),
 * the id of that region under the alias's country (`cnhk`).
 */
export function aliasTarget(aliasId: string, replacement: string): string | undefined {
	if (/^[A-Z]{2}$/.test(replacement)) return `${aliasId.slice(0, 2)}${replacement.toLowerCase()}`
	return /^[a-z]{2}[a-z0-9]{1,4}$/.test(replacement) ? replacement : undefined
}

function aliasNames(): ReadonlyMap<string, string> {
	const byTarget = new Map<string, string>()
	for (const [aliasId, { _replacement }] of Object.entries(subdivisionAliases)) {
		const name = names[aliasId]
		const target = name === undefined ? undefined : aliasTarget(aliasId, _replacement)
		if (target !== undefined && !byTarget.has(target)) byTarget.set(target, name!)
	}
	return byTarget
}

const SUPERSCRIPT_DIGITS = /[¹²³⁰-⁹]+$/u

/** A CLDR subdivision id (`caon`) as its ISO 3166-2 code (`CA-ON`). */
export function isoSubdivisionCode(cldrId: string): string {
	return `${cldrId.slice(0, 2).toUpperCase()}-${cldrId.slice(2).toUpperCase()}`
}

function collect(country: string, id: string, into: Subdivision[], aliased: ReadonlyMap<string, string>): void {
	const name = (names[id] ?? aliased.get(id))?.replace(SUPERSCRIPT_DIGITS, '')
	into.push({ code: isoSubdivisionCode(id), country, ...(name === undefined ? {} : { name }) })
	for (const child of containment[id]?._contains ?? []) collect(country, child, into, aliased)
}

function buildSubdivisions(): readonly Subdivision[] {
	const subdivisions: Subdivision[] = []
	const aliased = aliasNames()
	for (const [parent, { _contains }] of Object.entries(containment)) {
		if (!/^[A-Z]{2}$/.test(parent)) continue
		for (const id of _contains) collect(parent, id, subdivisions, aliased)
	}
	const byCode = new Map(subdivisions.map((entry) => [entry.code, Object.freeze(entry)]))
	return Object.freeze([...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)))
}

/**
 * The CLDR regions provider: every current ISO 3166-2 subdivision with its
 * English name. Create a formatter with `providers: { regions: regionsProvider }`,
 * and pass it to `resolveCountry` and `resolveRegion`.
 */
export const regionsProvider: RegionsProvider = Object.freeze({
	entryPoint: '@asterdoc/format/regions',
	source: Object.freeze({ package: 'cldr-subdivisions-full', version: '49.0.0' }),
	subdivisions: buildSubdivisions(),
})
