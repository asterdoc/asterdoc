import type { RegionsProvider, Subdivision } from '@asterdoc/types'
import { aboutInput } from './shared'

export type { RegionsProvider, Subdivision } from '@asterdoc/types'

const ISO_3166_1 =
	'ADAND,AEARE,AFAFG,AGATG,AIAIA,ALALB,AMARM,AOAGO,AQATA,ARARG,ASASM,ATAUT,AUAUS,AWABW,AXALA,AZAZE,BABIH,BBBRB,BDBGD,BEBEL,BFBFA,BGBGR,BHBHR,BIBDI,BJBEN,BLBLM,BMBMU,BNBRN,BOBOL,BQBES,BRBRA,BSBHS,BTBTN,BVBVT,BWBWA,BYBLR,BZBLZ,CACAN,CCCCK,CDCOD,CFCAF,CGCOG,CHCHE,CICIV,CKCOK,CLCHL,CMCMR,CNCHN,COCOL,CRCRI,CUCUB,CVCPV,CWCUW,CXCXR,CYCYP,CZCZE,DEDEU,DJDJI,DKDNK,DMDMA,DODOM,DZDZA,ECECU,EEEST,EGEGY,EHESH,ERERI,ESESP,ETETH,FIFIN,FJFJI,FKFLK,FMFSM,FOFRO,FRFRA,GAGAB,GBGBR,GDGRD,GEGEO,GFGUF,GGGGY,GHGHA,GIGIB,GLGRL,GMGMB,GNGIN,GPGLP,GQGNQ,GRGRC,GSSGS,GTGTM,GUGUM,GWGNB,GYGUY,HKHKG,HMHMD,HNHND,HRHRV,HTHTI,HUHUN,IDIDN,IEIRL,ILISR,IMIMN,ININD,IOIOT,IQIRQ,IRIRN,ISISL,ITITA,JEJEY,JMJAM,JOJOR,JPJPN,KEKEN,KGKGZ,KHKHM,KIKIR,KMCOM,KNKNA,KPPRK,KRKOR,KWKWT,KYCYM,KZKAZ,LALAO,LBLBN,LCLCA,LILIE,LKLKA,LRLBR,LSLSO,LTLTU,LULUX,LVLVA,LYLBY,MAMAR,MCMCO,MDMDA,MEMNE,MFMAF,MGMDG,MHMHL,MKMKD,MLMLI,MMMMR,MNMNG,MOMAC,MPMNP,MQMTQ,MRMRT,MSMSR,MTMLT,MUMUS,MVMDV,MWMWI,MXMEX,MYMYS,MZMOZ,NANAM,NCNCL,NENER,NFNFK,NGNGA,NINIC,NLNLD,NONOR,NPNPL,NRNRU,NUNIU,NZNZL,OMOMN,PAPAN,PEPER,PFPYF,PGPNG,PHPHL,PKPAK,PLPOL,PMSPM,PNPCN,PRPRI,PSPSE,PTPRT,PWPLW,PYPRY,QAQAT,REREU,ROROU,RSSRB,RURUS,RWRWA,SASAU,SBSLB,SCSYC,SDSDN,SESWE,SGSGP,SHSHN,SISVN,SJSJM,SKSVK,SLSLE,SMSMR,SNSEN,SOSOM,SRSUR,SSSSD,STSTP,SVSLV,SXSXM,SYSYR,SZSWZ,TCTCA,TDTCD,TFATF,TGTGO,THTHA,TJTJK,TKTKL,TLTLS,TMTKM,TNTUN,TOTON,TRTUR,TTTTO,TVTUV,TWTWN,TZTZA,UAUKR,UGUGA,UMUMI,USUSA,UYURY,UZUZB,VAVAT,VCVCT,VEVEN,VGVGB,VIVIR,VNVNM,VUVUT,WFWLF,WSWSM,YEYEM,YTMYT,ZAZAF,ZMZMB,ZWZWE'

/**
 * The ISO 3166-1 code list: every officially assigned alpha-2 code with its
 * alpha-3 code. Former codes (ISO 3166-3) and reserved codes are not in it.
 */
export const COUNTRY_CODES: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(ISO_3166_1.split(',').map((entry) => [entry.slice(0, 2), entry.slice(2)])),
)

const ALPHA3_TO_ALPHA2: ReadonlyMap<string, string> = new Map(
	Object.entries(COUNTRY_CODES).map(([alpha2, alpha3]) => [alpha3, alpha2]),
)

const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
	'USA': ['US'],
	'U.S.': ['US'],
	'U.S.A.': ['US'],
	'United States of America': ['US'],
	'America': ['US'],
	'UK': ['GB'],
	'U.K.': ['GB'],
	'Great Britain': ['GB'],
	'Britain': ['GB'],
	'England': ['GB'],
	'Scotland': ['GB'],
	'Wales': ['GB'],
	'Northern Ireland': ['GB'],
	'Deutschland': ['DE'],
	'Holland': ['NL'],
	'Czech Republic': ['CZ'],
	'Ivory Coast': ['CI'],
	'Burma': ['MM'],
	'Swaziland': ['SZ'],
	'Macedonia': ['MK'],
	'Turkey': ['TR'],
	'Türkiye': ['TR'],
	'East Timor': ['TL'],
	'Cape Verde': ['CV'],
	'Cabo Verde': ['CV'],
	'UAE': ['AE'],
	'Vatican': ['VA'],
	'Holy See': ['VA'],
	'Russian Federation': ['RU'],
	'Republic of Korea': ['KR'],
	'DPRK': ['KP'],
	"Democratic People's Republic of Korea": ['KP'],
	'Korea': ['KR', 'KP'],
	'Democratic Republic of the Congo': ['CD'],
	'DR Congo': ['CD'],
	'DRC': ['CD'],
	'Republic of the Congo': ['CG'],
	'Congo': ['CD', 'CG'],
	'State of Palestine': ['PS'],
	'Viet Nam': ['VN'],
	'Lao PDR': ['LA'],
	'Brunei Darussalam': ['BN'],
	'Syrian Arab Republic': ['SY'],
	'Republic of Moldova': ['MD'],
	'United Republic of Tanzania': ['TZ'],
	'Federated States of Micronesia': ['FM'],
	'Keeling Islands': ['CC'],
}

const DUAL_CODED_SUBDIVISIONS: Readonly<Record<string, string>> = {
	'CN-HK': 'HK',
	'CN-MO': 'MO',
	'CN-TW': 'TW',
	'FI-01': 'AX',
	'FR-971': 'GP',
	'FR-972': 'MQ',
	'FR-973': 'GF',
	'FR-974': 'RE',
	'FR-976': 'YT',
	'FR-BL': 'BL',
	'FR-MF': 'MF',
	'FR-NC': 'NC',
	'FR-PF': 'PF',
	'FR-PM': 'PM',
	'FR-TF': 'TF',
	'FR-WF': 'WF',
	'NL-AW': 'AW',
	'NL-BQ1': 'BQ',
	'NL-BQ2': 'BQ',
	'NL-BQ3': 'BQ',
	'NL-CW': 'CW',
	'NL-SX': 'SX',
	'NO-21': 'SJ',
	'NO-22': 'SJ',
	'US-AS': 'AS',
	'US-GU': 'GU',
	'US-MP': 'MP',
	'US-PR': 'PR',
	'US-UM': 'UM',
	'US-VI': 'VI',
}


/** A country or subdivision an outcome offers instead of the input. */
export interface PlaceCandidate {
	/** An ISO 3166-1 alpha-2 code or a full ISO 3166-2 code. */
	readonly code: string
	/** A country's name, or a subdivision's name with its country's (`Georgia, United States`), so candidates that share a name stay apart. */
	readonly name: string
}

/** Why a country or region input did not resolve to one code. */
export type PlaceIssueCode =
	| 'unknown_country'
	| 'ambiguous_country'
	| 'needs_country'
	| 'unknown_region'
	| 'ambiguous_region'
	| 'missing_format_provider'

export interface PlaceFailure {
	readonly ok: false
	readonly code: PlaceIssueCode
	readonly message: string
	/** The message with the input written as `[redacted]` with its kind and length. */
	readonly redactedMessage: string
	readonly candidates: readonly PlaceCandidate[]
}

export type PlaceOutcome = { readonly ok: true; readonly value: string } | PlaceFailure

export interface CountryLookupOptions {
	/** The input locale: names in it are accepted besides English names. */
	readonly locale?: string
	/** Needed to accept a name: a name can be a country or a subdivision. */
	readonly regions?: RegionsProvider
}

export interface RegionLookupOptions {
	/** ISO 3166-1 alpha-2 code the subdivision must belong to. */
	readonly country?: string
	readonly regions?: RegionsProvider
}

const NEAREST = 5
/** The entry point of the regions provider, which `missing_format_provider` names. */
export const REGIONS_ENTRY_POINT = '@asterdoc/format/regions'

/**
 * A place name as lookup compares it: case, accents, punctuation and `&`
 * versus `and` do not count, `St.` reads as `Saint`, and a leading `the` is
 * dropped.
 */
export function normalizePlaceName(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[¹²³⁰-⁹]/g, '')
		.replace(/&/g, ' and ')
		.replace(/\bst\.?(?=\s|$)/g, 'saint')
		.replace(/['’ʼ`.]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/^the /, '')
}

function failure(code: PlaceIssueCode, message: string | { message: string; redactedMessage: string }, candidates: readonly PlaceCandidate[] = []): PlaceFailure {
	const texts = typeof message === 'string' ? { message, redactedMessage: message } : message
	return { ok: false, code, ...texts, candidates }
}

function missingRegions(): PlaceFailure {
	return failure('missing_format_provider', `Matching a country or subdivision name needs the regions provider: pass regionsProvider from ${REGIONS_ENTRY_POINT}.`)
}

/** Whether a value is an ISO 3166-1 alpha-2 code in the shipped list. */
export function isCountryCode(value: unknown): value is string {
	return typeof value === 'string' && Object.hasOwn(COUNTRY_CODES, value)
}

const displayNames = new Map<string, { long: Intl.DisplayNames; short: Intl.DisplayNames }>()

function namesFor(locale: string): { long: Intl.DisplayNames; short: Intl.DisplayNames } {
	let names = displayNames.get(locale)
	if (!names) {
		names = {
			long: new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }),
			short: new Intl.DisplayNames([locale], { type: 'region', style: 'short', fallback: 'code' }),
		}
		displayNames.set(locale, names)
	}
	return names
}

/** A country's name in `locale` (English by default), from the runtime's Intl data. */
export function countryName(code: string, locale = 'en'): string {
	return namesFor(locale).long.of(code) ?? code
}

const countryIndexes = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>()

function addName(index: Map<string, Set<string>>, name: string | undefined, code: string): void {
	if (name === undefined) return
	const key = normalizePlaceName(name)
	if (key.length === 0) return
	const codes = index.get(key) ?? new Set<string>()
	codes.add(code)
	index.set(key, codes)
}

function countryIndex(locale: string): ReadonlyMap<string, ReadonlySet<string>> {
	const cached = countryIndexes.get(locale)
	if (cached) return cached
	const index = new Map<string, Set<string>>()
	const locales = locale === 'en' ? ['en'] : ['en', locale]
	for (const tag of locales) {
		const names = namesFor(tag)
		for (const code of Object.keys(COUNTRY_CODES)) {
			const long = names.long.of(code)
			const short = names.short.of(code)
			if (long !== code) addName(index, long, code)
			if (short !== code) addName(index, short, code)
		}
	}
	for (const [alias, codes] of Object.entries(COUNTRY_ALIASES)) {
		for (const code of codes) addName(index, alias, code)
	}
	countryIndexes.set(locale, index)
	return index
}

function canonicalLocale(locale: string | undefined): string {
	if (locale === undefined) return 'en'
	try {
		return Intl.getCanonicalLocales(locale)[0] ?? 'en'
	} catch {
		return 'en'
	}
}

function distance(a: string, b: string): number {
	if (a === b) return 0
	const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
	for (let i = 1; i <= a.length; i++) {
		let diagonal = previous[0]!
		previous[0] = i
		for (let j = 1; j <= b.length; j++) {
			const above = previous[j]!
			previous[j] = Math.min(above + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
			diagonal = above
		}
	}
	return previous[b.length]!
}

function nearest<T>(input: string, entries: Iterable<readonly [string, T]>, key: (value: T) => string): T[] {
	const target = normalizePlaceName(input)
	const best = new Map<string, { value: T; score: number }>()
	for (const [name, value] of entries) {
		const score = distance(target, name)
		const id = key(value)
		const current = best.get(id)
		if (!current || score < current.score) best.set(id, { value, score })
	}
	return [...best.values()]
		.sort((a, b) => a.score - b.score || key(a.value).localeCompare(key(b.value)))
		.slice(0, NEAREST)
		.map((entry) => entry.value)
}

function countryCandidate(code: string, locale: string): PlaceCandidate {
	return { code, name: countryName(code, locale) }
}

/**
 * Resolve a country input to its ISO 3166-1 alpha-2 code: an alpha-2 or
 * alpha-3 code in the shipped list, or an English name, alias or name in the
 * input locale. A name that is also the name of a subdivision of another
 * country (`Georgia`) is ambiguous, so names need `options.regions`.
 */
export function resolveCountry(input: string, options: CountryLookupOptions = {}): PlaceOutcome {
	const locale = canonicalLocale(options.locale)
	const trimmed = input.trim()
	const upper = trimmed.toUpperCase()
	if (isCountryCode(upper)) return { ok: true, value: upper }
	const fromAlpha3 = /^[A-Z]{3}$/.test(upper) ? ALPHA3_TO_ALPHA2.get(upper) : undefined
	if (fromAlpha3 !== undefined) return { ok: true, value: fromAlpha3 }

	const index = countryIndex(locale)
	const key = normalizePlaceName(trimmed)
	const codes = [...(index.get(key) ?? [])].sort()
	if (codes.length === 0) {
		const candidates = nearest(trimmed, [...index].flatMap(([name, set]) => [...set].map((code) => [name, code] as const)), (code) => code)
		return failure('unknown_country', aboutInput(trimmed, (shown) => `No country matches ${shown}.`), candidates.map((code) => countryCandidate(code, locale)))
	}
	if (codes.length > 1) {
		return failure('ambiguous_country', aboutInput(trimmed, (shown) => `${shown} names more than one country.`), codes.map((code) => countryCandidate(code, locale)))
	}
	if (!options.regions) return missingRegions()
	const [code] = codes as [string]
	const others = (regionIndex(options.regions).byName.get(key) ?? [])
		.filter((subdivision) => subdivision.country !== code && DUAL_CODED_SUBDIVISIONS[subdivision.code] !== code)
	if (others.length > 0) {
		return failure(
			'ambiguous_country',
			aboutInput(trimmed, (shown) => `${shown} names a country and a subdivision of another country.`),
			[countryCandidate(code, locale), ...others.map((subdivision) => regionCandidate(subdivision, locale))],
		)
	}
	return { ok: true, value: code }
}

interface RegionIndex {
	readonly byCode: ReadonlyMap<string, Subdivision>
	readonly byCountry: ReadonlyMap<string, readonly Subdivision[]>
	readonly byName: ReadonlyMap<string, readonly Subdivision[]>
}

const regionIndexes = new WeakMap<RegionsProvider, RegionIndex>()

function regionIndex(regions: RegionsProvider): RegionIndex {
	const cached = regionIndexes.get(regions)
	if (cached) return cached
	const byCode = new Map<string, Subdivision>()
	const byCountry = new Map<string, Subdivision[]>()
	const byName = new Map<string, Subdivision[]>()
	for (const subdivision of regions.subdivisions) {
		byCode.set(subdivision.code, subdivision)
		byCountry.set(subdivision.country, [...(byCountry.get(subdivision.country) ?? []), subdivision])
		if (subdivision.name !== undefined) {
			const key = normalizePlaceName(subdivision.name)
			byName.set(key, [...(byName.get(key) ?? []), subdivision])
		}
	}
	const index = { byCode, byCountry, byName }
	regionIndexes.set(regions, index)
	return index
}

/** A subdivision's display name: its name, or its code when the data has no name. */
export function regionName(subdivision: Subdivision): string {
	return subdivision.name ?? subdivision.code
}

function regionCandidate(subdivision: Subdivision, locale = 'en'): PlaceCandidate {
	return { code: subdivision.code, name: `${regionName(subdivision)}, ${countryName(subdivision.country, locale)}` }
}

/** The subdivision with a full ISO 3166-2 code, if the provider has it. */
export function findSubdivision(code: string, regions: RegionsProvider): Subdivision | undefined {
	return regionIndex(regions).byCode.get(code.trim().toUpperCase())
}

/** Every subdivision of a country the provider has, in code order. */
export function subdivisionsOf(country: string, regions: RegionsProvider): readonly Subdivision[] {
	return regionIndex(regions).byCountry.get(country) ?? []
}

function nearestRegions(input: string, pool: readonly Subdivision[]): PlaceCandidate[] {
	const entries = pool.flatMap((subdivision) => [
		[normalizePlaceName(subdivision.code.slice(subdivision.code.indexOf('-') + 1)), subdivision] as const,
		...(subdivision.name === undefined ? [] : [[normalizePlaceName(subdivision.name), subdivision] as const]),
	])
	return nearest(input, entries, (subdivision) => subdivision.code).map((subdivision) => regionCandidate(subdivision))
}

function unique(subdivisions: readonly Subdivision[]): Subdivision[] {
	return [...new Map(subdivisions.map((subdivision) => [subdivision.code, subdivision])).values()]
		.sort((a, b) => a.code.localeCompare(b.code))
}

const FULL_CODE = /^([A-Za-z]{2})-([A-Za-z0-9]{1,3})$/
const SHORT_CODE = /^[A-Za-z0-9]{1,3}$/

/**
 * Resolve a subdivision input to its full ISO 3166-2 code: the full code
 * (`CA-ON`), the part after the dash (`ON`) when `options.country` is given,
 * or an English subdivision name. Without a country, full codes and names use
 * the global lookup; a name used in more than one country is ambiguous.
 */
export function resolveRegion(input: string, options: RegionLookupOptions = {}): PlaceOutcome {
	if (!options.regions) return missingRegions()
	const index = regionIndex(options.regions)
	const trimmed = input.trim()
	const country = options.country
	const pool = country === undefined ? options.regions.subdivisions : index.byCountry.get(country) ?? []
	const full = FULL_CODE.exec(trimmed)
	if (full) {
		const subdivision = index.byCode.get(trimmed.toUpperCase())
		if (subdivision && (country === undefined || subdivision.country === country)) return { ok: true, value: subdivision.code }
		const where = country === undefined ? '' : ` in ${country}`
		return failure('unknown_region', aboutInput(trimmed.toUpperCase(), (shown) => `No subdivision${where} has the code ${shown}.`), nearestRegions(full[2]!, pool))
	}
	const key = normalizePlaceName(trimmed)
	if (country !== undefined) {
		const byShortCode = SHORT_CODE.test(trimmed) ? index.byCode.get(`${country}-${trimmed.toUpperCase()}`) : undefined
		const byName = (index.byName.get(key) ?? []).filter((subdivision) => subdivision.country === country)
		const matches = unique([...(byShortCode ? [byShortCode] : []), ...byName])
		if (matches.length === 1) return { ok: true, value: matches[0]!.code }
		if (matches.length > 1) {
			return failure('ambiguous_region', aboutInput(trimmed, (shown) => `${shown} names more than one subdivision of ${country}.`), matches.map((subdivision) => regionCandidate(subdivision)))
		}
		return failure('unknown_region', aboutInput(trimmed, (shown) => `No subdivision of ${country} matches ${shown}.`), nearestRegions(trimmed, pool))
	}
	const matches = unique(index.byName.get(key) ?? [])
	if (matches.length === 1) return { ok: true, value: matches[0]!.code }
	if (matches.length > 1) {
		return failure('ambiguous_region', aboutInput(trimmed, (shown) => `${shown} names subdivisions in more than one place.`), matches.map((subdivision) => regionCandidate(subdivision)))
	}
	if (SHORT_CODE.test(trimmed)) {
		return failure('needs_country', aboutInput(trimmed, (shown) => `${shown} reads as a subdivision code, which needs a country.`))
	}
	return failure('unknown_region', aboutInput(trimmed, (shown) => `No subdivision matches ${shown}.`), nearestRegions(trimmed, pool))
}

/**
 * An address region as a `codes: true` address stores it: the ISO 3166-2
 * code after the dash (`ON`), read in the address country. A country the
 * provider lists no subdivisions for has no codes to store, so a region that
 * is not a full code stays exactly as given; a full code must still name a
 * subdivision of that country, so `US-CA` under `VA` is refused.
 */
export function resolveAddressRegion(input: string, country: string, regions?: RegionsProvider): PlaceOutcome {
	if (!regions) return missingRegions()
	if (subdivisionsOf(country, regions).length === 0 && !FULL_CODE.test(input.trim())) return { ok: true, value: input }
	const outcome = resolveRegion(input, { country, regions })
	return outcome.ok ? { ok: true, value: outcome.value.slice(outcome.value.indexOf('-') + 1) } : outcome
}

/** Whether the provider lists subdivisions for a country. */
export function hasSubdivisions(country: string, regions: RegionsProvider): boolean {
	return subdivisionsOf(country, regions).length > 0
}

/** How a subdivision prints: the code after the dash, the whole code, or its name. */
export type RegionDisplay = 'code' | 'name' | 'full'

/** A subdivision's text for a display choice. */
export function displayRegion(code: string, display: RegionDisplay, regions: RegionsProvider): string {
	if (display === 'full') return code
	if (display === 'code') return code.slice(code.indexOf('-') + 1)
	const subdivision = findSubdivision(code, regions)
	return subdivision ? regionName(subdivision) : code
}
