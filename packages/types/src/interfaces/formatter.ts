import type {
	Address,
	Attachment,
	Bbox,
	Coordinate,
	Duration,
	Identification,
	Money,
	Organization,
	Person,
	Phone,
	Signature,
} from '../schemas/primitives'
import type { EnumOption, EnumOptionValue } from '../schemas/artifacts/form/field'
import type { Party } from '../runtime'

/** Value families understood by the public formatter contract. */
export type FormatKind =
	| 'money'
	| 'address'
	| 'phone'
	| 'person'
	| 'organization'
	| 'party'
	| 'coordinate'
	| 'bbox'
	| 'duration'
	| 'identification'
	| 'attachment'
	| 'signature'
	| 'date'
	| 'datetime'
	| 'time'
	| 'number'
	| 'percentage'
	| 'boolean'
	| 'enum'
	| 'multiselect'
	| 'rating'

export type NumericFormatKind = 'money' | 'number' | 'percentage'
export type ContactFormatKind = 'address' | 'phone' | 'person' | 'organization' | 'party'
export type TemporalFormatKind = 'date' | 'datetime' | 'time' | 'duration'
export type CaptureFormatKind = 'coordinate' | 'bbox' | 'identification' | 'attachment' | 'signature'
export type SelectionFormatKind = 'boolean' | 'enum' | 'multiselect' | 'rating'

type NumberOptionsBase = Omit<
	Intl.NumberFormatOptions,
	'style' | 'currency' | 'currencyDisplay' | 'currencySign' | 'unit' | 'unitDisplay'
>

/** Options for formatting a plain number. */
export type NumberFormatOptions = NumberOptionsBase

/** Options for formatting a monetary amount. */
export interface MoneyFormatOptions extends NumberOptionsBase {
	/** Use `none` when a template already prints its own currency symbol. */
	currencyDisplay?: Intl.NumberFormatOptions['currencyDisplay'] | 'none'
	currencySign?: Intl.NumberFormatOptions['currencySign']
}

/** Options for formatting a percentage-point value. */
export type PercentageFormatOptions = NumberOptionsBase

export type AddressLayoutPolicy = 'country' | 'generic'

export interface AddressLayoutContext {
	readonly locale: string
	readonly options: AddressFormatOptions
}

/** A caller-provided layout for one normalized ISO 3166-1 country code. */
export type AddressLayoutFormatter = (address: Address, context: AddressLayoutContext) => string

/** Options for postal address presentation. */
export interface AddressFormatOptions {
	/** Use country-specific layouts by default, or an explicit component-preserving generic layout. */
	layout?: AddressLayoutPolicy
	/** Additional or replacement layouts keyed by ISO 3166-1 alpha-2 country code. */
	countryLayouts?: Readonly<Record<string, AddressLayoutFormatter>>
	/**
	 * ISO 3166-1 alpha-2 code whose layout applies, for an address whose
	 * `country` holds a display name rather than a code.
	 */
	layoutCountry?: string
}

/**
 * How a phone number prints: `e164` as stored (`+12125551234`),
 * `international` (`+1 212 555 1234`) and `national` (`(212) 555-1234`) in the
 * numbering plan's own layout, or `digits`, the national significant number
 * with no trunk prefix or punctuation (`2125551234`).
 */
export type PhoneStyle = 'e164' | 'international' | 'national' | 'digits'

/** Options for phone presentation. */
export interface PhoneFormatOptions {
	/** Override the package-owned extension label for this call or formatter. */
	extensionLabel?: string
	/**
	 * How the number prints; the extension prints after it as with `e164`.
	 * Every style but `e164` needs the phone provider.
	 * @default 'e164'
	 */
	style?: PhoneStyle
	/**
	 * The ISO 3166-1 alpha-2 region whose numbering plan a national box
	 * expects. Under `national` and `digits`, a number with another country
	 * calling code is refused rather than printed without it.
	 */
	region?: string
}

/** A phone number as a phone provider reads it. */
export interface PhoneNumberDetails {
	/** The number in E.164 form. */
	readonly number: string
	/** The country calling code, without `+`: `1`, `44`. */
	readonly countryCallingCode: string
	/** The national significant number: no trunk prefix, no punctuation. */
	readonly nationalNumber: string
	/** The ISO 3166-1 alpha-2 region the number belongs to, when one region claims it. */
	readonly region?: string
	/** The number in its plan's international layout. */
	readonly international: string
	/** The number in its plan's national layout, with the trunk prefix. */
	readonly national: string
}

/** The phone styles a phone provider prints. */
export type ProvidedPhoneStyle = Exclude<PhoneStyle, 'e164'>

/**
 * Phone numbering-plan data, which phone styles other than `e164` need.
 * `@asterdoc/format/phone` provides one.
 */
export interface PhoneProvider {
	/**
	 * Read a valid phone number: E.164 or international text, or national text
	 * when `region` names its plan. Undefined when the text is not a valid number.
	 */
	parse(text: string, region?: string): PhoneNumberDetails | undefined
	/** The country calling code of a region, without `+`, or undefined for a region the data does not know. */
	callingCode(region: string): string | undefined
	/**
	 * The longest text a style prints, for a number of `region`'s plan or of
	 * any plan, with every digit written `0`. Fit checks measure it.
	 */
	longest(style: ProvidedPhoneStyle, region?: string): string
}

/**
 * Lookup data a formatter is created with. A format that needs a provider the
 * formatter lacks fails with `missing_format_provider`, naming its entry point.
 */
/** One ISO 3166-2 subdivision a regions provider knows. */
export interface Subdivision {
	/** The full ISO 3166-2 code, upper case: `CA-ON`. */
	readonly code: string
	/** The ISO 3166-1 alpha-2 code of its country: `CA`. */
	readonly country: string
	/** Its English name, when the provider's data has one. */
	readonly name?: string
}

/**
 * Subdivision data for region lookup and display, and for country names that
 * are also subdivision names. `@asterdoc/format/regions` exports one built
 * from CLDR.
 */
export interface RegionsProvider {
	/** The entry point this provider comes from, named in `missing_format_provider` errors. */
	readonly entryPoint: string
	/** The data release the subdivisions come from. */
	readonly source: { readonly package: string; readonly version: string }
	readonly subdivisions: readonly Subdivision[]
}

export interface FormatProviders {
	/** Phone numbering plans, from `@asterdoc/format/phone`. */
	readonly phone?: PhoneProvider
	/** ISO 3166-2 subdivisions with English names, from `@asterdoc/format/regions`. */
	readonly regions?: RegionsProvider
}

/** Options for person presentation. */
export type PersonFormatOptions = Record<string, never>

/** Options for organization presentation. */
export type OrganizationFormatOptions = Record<string, never>

/** Options for party dispatch when shape alone is not enough to identify an identity. */
export interface PartyFormatOptions {
	/** Explicitly identify a party whose fields do not carry a distinguishing identity member. */
	partyType?: 'person' | 'organization'
}

/** Shared temporal policy options. */
export interface TemporalFormatOptions {
	/** Override the formatter's timezone for instant-bearing values. */
	timeZone?: string
	/** Override the formatter's calendar for this call. */
	calendar?: string
}

/** Options for calendar-date presentation. */
export type DateFormatOptions = Omit<Intl.DateTimeFormatOptions, 'calendar' | 'numberingSystem' | 'timeZone'> & TemporalFormatOptions

/** Options for datetime presentation. */
export type DatetimeFormatOptions = Omit<Intl.DateTimeFormatOptions, 'calendar' | 'numberingSystem' | 'timeZone'> & TemporalFormatOptions

/** Options for time-of-day presentation. */
export type TimeFormatOptions = Omit<Intl.DateTimeFormatOptions, 'calendar' | 'numberingSystem' | 'timeZone'> & TemporalFormatOptions

/** Options for localized ISO 8601 duration presentation. */
export type DurationFormatOptions = Omit<
	Intl.NumberFormatOptions,
	'style' | 'currency' | 'currencyDisplay' | 'currencySign' | 'unit' | 'unitDisplay'
>

/** Options for coordinate presentation. Number options control both axes. */
export type CoordinateFormatOptions = NumberFormatOptions

/** Options for bounding-box presentation. Number options control every coordinate. */
export type BboxFormatOptions = NumberFormatOptions

/** Options for identification presentation, including nested date formatting. */
export type IdentificationFormatOptions = DateFormatOptions

/** Attachments have no locale-owned presentation options. */
export type AttachmentFormatOptions = Record<string, never>

/** Options for signature presentation, including nested capture-date formatting. */
export type SignatureFormatOptions = DateFormatOptions

/** What to do with a value no declared option matches. */
export type UnknownOptionPolicy = 'error' | 'value'

/** Options for boolean presentation. */
export interface BooleanFormatOptions {
	/** Replaces the locale's own word for true. */
	trueLabel?: string
	/** Replaces the locale's own word for false. */
	falseLabel?: string
}

/** Options for single-choice presentation. */
export interface EnumFormatOptions {
	/** The declared options whose labels present the value. */
	options?: readonly EnumOption[]
	/** Print a value no option declares as itself, or refuse it. @default 'error' */
	unknownOption?: UnknownOptionPolicy
}

/** Which relation the locale's list joiner expresses between the labels. */
export type SelectionListType = 'conjunction' | 'disjunction' | 'unit'

/** How verbose the locale's list conjunction and separator are. */
export type SelectionListStyle = 'long' | 'short' | 'narrow'

/** Options for multiple-choice presentation. */
export interface MultiselectFormatOptions extends EnumFormatOptions {
	/** Which list relation joins the labels. @default 'conjunction' */
	listType?: SelectionListType
	/** How verbose the locale's list conjunction and separator are. @default 'long' */
	listStyle?: SelectionListStyle
}

/** Whether a rating prints with its scale or alone. */
export type RatingDisplay = 'scale' | 'value'

/** Options for rating presentation. */
export interface RatingFormatOptions {
	/** Top of the rating's scale, as the field declares it. A rating with no scale is unsupported. */
	max?: number
	/** Print the value with its scale, or the value alone. @default 'scale' */
	display?: RatingDisplay
}

export type FormatOptionsByKind = {
	money: MoneyFormatOptions
	number: NumberFormatOptions
	percentage: PercentageFormatOptions
	address: AddressFormatOptions
	phone: PhoneFormatOptions
	person: PersonFormatOptions
	organization: OrganizationFormatOptions
	party: PartyFormatOptions
	coordinate: CoordinateFormatOptions
	bbox: BboxFormatOptions
	duration: DurationFormatOptions
	identification: IdentificationFormatOptions
	attachment: AttachmentFormatOptions
	signature: SignatureFormatOptions
	date: DateFormatOptions
	datetime: DatetimeFormatOptions
	time: TimeFormatOptions
	boolean: BooleanFormatOptions
	enum: EnumFormatOptions
	multiselect: MultiselectFormatOptions
	rating: RatingFormatOptions
}

export type FormatInputByKind = {
	money: Money | Partial<Money> | Record<string, unknown> | null | undefined
	number: number | null | undefined
	percentage: number | null | undefined
	address: Address | Partial<Address> | Record<string, unknown> | null | undefined
	phone: Phone | Partial<Phone> | string | Record<string, unknown> | null | undefined
	person: Person | Partial<Person> | Record<string, unknown> | null | undefined
	organization: Organization | Partial<Organization> | Record<string, unknown> | null | undefined
	party: Party | Partial<Person> | Partial<Organization> | Record<string, unknown> | null | undefined
	coordinate: Coordinate | Partial<Coordinate> | Record<string, unknown> | null | undefined
	bbox: Bbox | Partial<Bbox> | Record<string, unknown> | null | undefined
	duration: Duration | string | null | undefined
	identification: Identification | Partial<Identification> | Record<string, unknown> | null | undefined
	attachment: Attachment | Partial<Attachment> | Record<string, unknown> | null | undefined
	signature: Signature | Partial<Signature> | Record<string, unknown> | null | undefined
	date: string | Date | null | undefined
	datetime: string | Date | null | undefined
	time: string | null | undefined
	boolean: boolean | null | undefined
	enum: EnumOptionValue | null | undefined
	multiselect: readonly EnumOptionValue[] | null | undefined
	rating: number | null | undefined
}

/** Per-call locale settings can specialize a formatter without mutating it. */
export type FormatCallOptions<K extends FormatKind> = FormatOptionsByKind[K] & {
	locale?: string
	numberingSystem?: string
}

export interface FormatterMessages {
	/** Package-owned messages for a locale, keyed by the message name. */
	readonly [locale: string]: Readonly<Record<string, string>>
}

/**
 * Explicit policy for rendering values while an artifact is still being
 * filled.  The policy is carried alongside the formatter so every renderer
 * sees the same missing and incomplete presentation choice.
 */
export interface FormatterProgressivePolicy {
	/** Text shown for an absent value. Defaults to an em dash. */
	readonly missing?: string
	/** Text shown for a supplied composite that lacks required members. Defaults to an ellipsis. */
	readonly incomplete?: string
}

export type UnsupportedLocalePolicy = 'error' | 'fallback'

export interface FormatterOptions {
	/** Standard BCP 47 locale identifier. Defaults to `en-US`. */
	locale?: string
	/** Locale used for unsupported runtime locales and as an explicit fallback for missing package messages. */
	fallbackLocale?: string
	/** How construction and per-call locale overrides handle unsupported locales. */
	unsupportedLocale?: UnsupportedLocalePolicy
	/** Timezone for instants in temporal and capture values. Defaults to UTC. */
	timeZone?: string
	/** Calendar for temporal and capture values. Defaults to Gregorian. */
	calendar?: string
	/** Numbering system used by numeric and temporal formatters. */
	numberingSystem?: string
	/** Maximum number of Intl formatter configurations retained by this instance. */
	cacheSize?: number
	/** Default options for `number` values. */
	number?: NumberFormatOptions
	/** Default options for `money` values. */
	money?: MoneyFormatOptions
	/** Default options for `percentage` values. */
	percentage?: PercentageFormatOptions
	/** Caller-supplied package messages, merged over the built-in locale messages. */
	messages?: FormatterMessages
	address?: AddressFormatOptions
	phone?: PhoneFormatOptions
	person?: PersonFormatOptions
	organization?: OrganizationFormatOptions
	party?: PartyFormatOptions
	date?: DateFormatOptions
	datetime?: DatetimeFormatOptions
	time?: TimeFormatOptions
	duration?: DurationFormatOptions
	coordinate?: CoordinateFormatOptions
	bbox?: BboxFormatOptions
	identification?: IdentificationFormatOptions
	attachment?: AttachmentFormatOptions
	signature?: SignatureFormatOptions
	boolean?: BooleanFormatOptions
	enum?: EnumFormatOptions
	multiselect?: MultiselectFormatOptions
	rating?: RatingFormatOptions
	overrides?: FormatterOverrides
	/** Lookup data some formats need. `compose()` keeps the providers and adds these over them. */
	providers?: FormatProviders
}

export type NumericValueByKind = {
	number: number
	money: Money | Partial<Money> | Record<string, unknown>
	percentage: number
}

export type ContactValueByKind = {
	address: FormatInputByKind['address']
	phone: FormatInputByKind['phone']
	person: FormatInputByKind['person']
	organization: FormatInputByKind['organization']
	party: FormatInputByKind['party']
}

export type TemporalValueByKind = {
	date: string | Date
	datetime: string | Date
	time: string
	duration: Duration | string
}

export type CaptureValueByKind = {
	coordinate: FormatInputByKind['coordinate']
	bbox: FormatInputByKind['bbox']
	identification: FormatInputByKind['identification']
	attachment: FormatInputByKind['attachment']
	signature: FormatInputByKind['signature']
}

export type SelectionValueByKind = {
	boolean: boolean
	enum: EnumOptionValue
	multiselect: readonly EnumOptionValue[]
	rating: number
}

export interface FormatImplementationContext<K extends NumericFormatKind> {
	readonly kind: K
	readonly locale: string
	readonly options: FormatCallOptions<K>
	/** Call the implementation that was active before this override. */
	readonly delegate: (
		value?: NumericValueByKind[K],
		options?: FormatCallOptions<K>,
	) => string
}

export type FormatImplementation<K extends NumericFormatKind> = (
	value: NumericValueByKind[K],
	options: FormatCallOptions<K>,
	context: FormatImplementationContext<K>,
) => string

export interface ContactFormatImplementationContext<K extends ContactFormatKind> {
	readonly kind: K
	readonly locale: string
	readonly options: FormatCallOptions<K>
	/** Call the implementation that was active before this override. */
	readonly delegate: (
		value?: ContactValueByKind[K],
		options?: FormatCallOptions<K>,
	) => string
}

export type ContactFormatImplementation<K extends ContactFormatKind> = (
	value: ContactValueByKind[K],
	options: FormatCallOptions<K>,
	context: ContactFormatImplementationContext<K>,
) => string

export interface TemporalFormatImplementationContext<K extends TemporalFormatKind> {
	readonly kind: K
	readonly locale: string
	readonly options: FormatCallOptions<K>
	/** Call the implementation that was active before this override. */
	readonly delegate: (
		value?: TemporalValueByKind[K],
		options?: FormatCallOptions<K>,
	) => string
}

export type TemporalFormatImplementation<K extends TemporalFormatKind> = (
	value: TemporalValueByKind[K],
	options: FormatCallOptions<K>,
	context: TemporalFormatImplementationContext<K>,
) => string

export interface CaptureFormatImplementationContext<K extends CaptureFormatKind> {
	readonly kind: K
	readonly locale: string
	readonly options: FormatCallOptions<K>
	/** Call the implementation that was active before this override. */
	readonly delegate: (
		value?: CaptureValueByKind[K],
		options?: FormatCallOptions<K>,
	) => string
}

export type CaptureFormatImplementation<K extends CaptureFormatKind> = (
	value: CaptureValueByKind[K],
	options: FormatCallOptions<K>,
	context: CaptureFormatImplementationContext<K>,
) => string

export interface SelectionFormatImplementationContext<K extends SelectionFormatKind> {
	readonly kind: K
	readonly locale: string
	readonly options: FormatCallOptions<K>
	/** Call the implementation that was active before this override. */
	readonly delegate: (
		value?: SelectionValueByKind[K],
		options?: FormatCallOptions<K>,
	) => string
}

export type SelectionFormatImplementation<K extends SelectionFormatKind> = (
	value: SelectionValueByKind[K],
	options: FormatCallOptions<K>,
	context: SelectionFormatImplementationContext<K>,
) => string

export type FormatterOverrides = Partial<{
	[K in NumericFormatKind]: FormatImplementation<K>
}> & Partial<{
	[K in ContactFormatKind]: ContactFormatImplementation<K>
}> & Partial<{
	[K in TemporalFormatKind]: TemporalFormatImplementation<K>
}> & Partial<{
	[K in CaptureFormatKind]: CaptureFormatImplementation<K>
}> & Partial<{
	[K in SelectionFormatKind]: SelectionFormatImplementation<K>
}>

export type FormatStatus =
	| 'formatted'
	| 'missing'
	| 'incomplete'
	| 'invalid'
	| 'unsupported'
	| 'error'

export interface FormatIssue {
	readonly code: string
	readonly message: string
	readonly path?: string
	readonly kind?: FormatKind | string
	readonly cause?: unknown
}

export interface FormattedResult {
	readonly success: true
	readonly status: 'formatted'
	readonly value: string
}

export interface UnformattedResult {
	readonly success: false
	readonly status: Exclude<FormatStatus, 'formatted'>
	readonly issues: readonly FormatIssue[]
}

export type FormatResult = FormattedResult | UnformattedResult

export interface FormatterCacheBucketStats {
	readonly size: number
	readonly hits: number
	readonly misses: number
	readonly limit: number
}

/** Each bounded cache a formatter keeps: the Intl instances per kind, and the timezone validators. */
export type FormatterCacheBucket =
	| 'number'
	| 'money'
	| 'percentage'
	| 'date'
	| 'datetime'
	| 'time'
	| 'timeZone'
	| 'duration'
	| 'durationPlural'
	| 'durationList'
	| 'selectionList'

export type FormatterCacheStats = {
	readonly [B in FormatterCacheBucket]: FormatterCacheBucketStats
}

export interface Formatter {
	readonly locale: string
	/** Locale used when the requested locale has no package-owned message. */
	readonly fallbackLocale?: string
	readonly timeZone: string
	readonly calendar: string
	readonly numberingSystem?: string
	readonly messages: FormatterMessages
	/** The lookup data this formatter was created with. */
	readonly providers: FormatProviders

	format<K extends FormatKind>(
		kind: K,
		value: FormatInputByKind[K],
		options?: FormatCallOptions<K>,
	): string
	safeFormat<K extends FormatKind>(
		kind: K,
		value: FormatInputByKind[K],
		options?: FormatCallOptions<K>,
	): FormatResult

	formatNumber(value: FormatInputByKind['number'], options?: FormatCallOptions<'number'>): string
	formatMoney(value: FormatInputByKind['money'], options?: FormatCallOptions<'money'>): string
	formatPercentage(value: FormatInputByKind['percentage'], options?: FormatCallOptions<'percentage'>): string
	formatAddress(value: FormatInputByKind['address'], options?: FormatCallOptions<'address'>): string
	formatPhone(value: FormatInputByKind['phone'], options?: FormatCallOptions<'phone'>): string
	formatPerson(value: FormatInputByKind['person'], options?: FormatCallOptions<'person'>): string
	formatOrganization(value: FormatInputByKind['organization'], options?: FormatCallOptions<'organization'>): string
	formatParty(value: FormatInputByKind['party'], options?: FormatCallOptions<'party'>): string
	formatDate(value: FormatInputByKind['date'], options?: FormatCallOptions<'date'>): string
	formatDatetime(value: FormatInputByKind['datetime'], options?: FormatCallOptions<'datetime'>): string
	formatTime(value: FormatInputByKind['time'], options?: FormatCallOptions<'time'>): string
	formatDuration(value: FormatInputByKind['duration'], options?: FormatCallOptions<'duration'>): string
	formatCoordinate(value: FormatInputByKind['coordinate'], options?: FormatCallOptions<'coordinate'>): string
	formatBbox(value: FormatInputByKind['bbox'], options?: FormatCallOptions<'bbox'>): string
	formatIdentification(value: FormatInputByKind['identification'], options?: FormatCallOptions<'identification'>): string
	formatAttachment(value: FormatInputByKind['attachment'], options?: FormatCallOptions<'attachment'>): string
	formatSignature(value: FormatInputByKind['signature'], options?: FormatCallOptions<'signature'>): string
	formatBoolean(value: FormatInputByKind['boolean'], options?: FormatCallOptions<'boolean'>): string
	formatEnum(value: FormatInputByKind['enum'], options?: FormatCallOptions<'enum'>): string
	formatMultiselect(value: FormatInputByKind['multiselect'], options?: FormatCallOptions<'multiselect'>): string
	formatRating(value: FormatInputByKind['rating'], options?: FormatCallOptions<'rating'>): string
	safeFormatNumber(value: FormatInputByKind['number'], options?: FormatCallOptions<'number'>): FormatResult
	safeFormatMoney(value: FormatInputByKind['money'], options?: FormatCallOptions<'money'>): FormatResult
	safeFormatPercentage(value: FormatInputByKind['percentage'], options?: FormatCallOptions<'percentage'>): FormatResult
	safeFormatAddress(value: FormatInputByKind['address'], options?: FormatCallOptions<'address'>): FormatResult
	safeFormatPhone(value: FormatInputByKind['phone'], options?: FormatCallOptions<'phone'>): FormatResult
	safeFormatPerson(value: FormatInputByKind['person'], options?: FormatCallOptions<'person'>): FormatResult
	safeFormatOrganization(value: FormatInputByKind['organization'], options?: FormatCallOptions<'organization'>): FormatResult
	safeFormatParty(value: FormatInputByKind['party'], options?: FormatCallOptions<'party'>): FormatResult
	safeFormatDate(value: FormatInputByKind['date'], options?: FormatCallOptions<'date'>): FormatResult
	safeFormatDatetime(value: FormatInputByKind['datetime'], options?: FormatCallOptions<'datetime'>): FormatResult
	safeFormatTime(value: FormatInputByKind['time'], options?: FormatCallOptions<'time'>): FormatResult
	safeFormatDuration(value: FormatInputByKind['duration'], options?: FormatCallOptions<'duration'>): FormatResult
	safeFormatCoordinate(value: FormatInputByKind['coordinate'], options?: FormatCallOptions<'coordinate'>): FormatResult
	safeFormatBbox(value: FormatInputByKind['bbox'], options?: FormatCallOptions<'bbox'>): FormatResult
	safeFormatIdentification(value: FormatInputByKind['identification'], options?: FormatCallOptions<'identification'>): FormatResult
	safeFormatAttachment(value: FormatInputByKind['attachment'], options?: FormatCallOptions<'attachment'>): FormatResult
	safeFormatSignature(value: FormatInputByKind['signature'], options?: FormatCallOptions<'signature'>): FormatResult
	safeFormatBoolean(value: FormatInputByKind['boolean'], options?: FormatCallOptions<'boolean'>): FormatResult
	safeFormatEnum(value: FormatInputByKind['enum'], options?: FormatCallOptions<'enum'>): FormatResult
	safeFormatMultiselect(value: FormatInputByKind['multiselect'], options?: FormatCallOptions<'multiselect'>): FormatResult
	safeFormatRating(value: FormatInputByKind['rating'], options?: FormatCallOptions<'rating'>): FormatResult

	/** Create an independent formatter with merged configuration. */
	compose(options?: FormatterOptions): Formatter
	withOverrides(overrides: FormatterOverrides): Formatter

	cacheStats(): FormatterCacheStats
}
