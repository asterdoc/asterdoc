import { z } from 'zod';
import { ChecksumSchema } from '../../primitives/checksum';

/**
 * Field type for a signature slot (mirrors SigningFieldType).
 */
export const SignatureSlotTypeSchema = z.enum(['signature', 'initials', 'date_signed', 'capacity', 'printed_name'])
	.describe('Type of signing field: signature/initials (glyph), date_signed, capacity (signer role/title), or printed_name');

const AbsolutePlacementSchema = z.object({
	page: z.number().int().min(1).describe('1-based page number'),
	x: z.number().min(0).describe('X in points from the left page edge'),
	y: z.number().min(0).describe('Y in points from the top page edge'),
	width: z.number().min(1).describe('Width in points'),
	height: z.number().min(1).describe('Height in points'),
}).strict().meta({ title: 'AbsolutePlacement' });

const AnchorPlacementSchema = z.object({
	anchor: z.object({
		text: z.string().min(1).max(500).describe('Literal document text to find; must be unique unless occurrence is set'),
		offsetX: z.number().describe('Horizontal offset in points from the left of the found text').optional(),
		offsetY: z.number().describe('Vertical offset in points from the top of the found text').optional(),
		occurrence: z.number().int().min(1).describe('1-based match index in reading order when the text repeats').optional(),
	}).strict(),
	width: z.number().min(1).describe('Width in points'),
	height: z.number().min(1).describe('Height in points'),
}).strict().meta({ title: 'AnchorPlacement' });

/**
 * Signature slot: one signing field on a layer, keyed by slot id.
 */
export const SignatureSlotSchema = z.object({
	party: z.object({
		role: z.string().min(1).max(100).describe('Party role this slot binds to'),
		index: z.number().int().min(0).describe('0-based index for multi-party roles; defaults to 0').optional(),
	}).strict(),
	type: SignatureSlotTypeSchema,
	required: z.boolean().describe('Whether this slot must be signed. Defaults to true').optional(),
	label: z.string().min(1).max(200).describe('Human-readable label').optional(),
	placement: z.union([
		z.literal('flow').describe('In-flow: the field sits where the template content places it; located after conversion via an injected marker'),
		AbsolutePlacementSchema,
		AnchorPlacementSchema,
	]).describe("Placement: 'flow', absolute coordinates, or a text anchor"),
}).strict().meta({
	title: 'SignatureSlot',
	description: 'Signature slot binding a party to a placement on this layer',
});

/**
 * MIME types that name a React composition module.
 *
 * A composition is a React component in a `.tsx` or `.jsx` file. The layer that
 * declares one points at the module, so it is always a file layer: an inline
 * layer of one of these types carries source where a pointer belongs and is
 * rejected here.
 *
 * This is the one definition. `@asterdoc/core` imports it for its render
 * dispatch rather than restating it, so validation and dispatch cannot drift.
 */
export const REACT_LAYER_MIME_TYPES = ['text/tsx', 'text/jsx'] as const;

/**
 * Whether a MIME type names a React composition module.
 *
 * Case-insensitive, because MIME types are: RFC 2045 says the type and subtype
 * are compared without regard to case, and a layer written `TEXT/TSX` is the
 * same layer. Validation and render dispatch agree on that, or one would accept
 * what the other refuses.
 */
export function isReactLayerMimeType(mimeType: string | undefined): boolean {
	return mimeType !== undefined && (REACT_LAYER_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/** The rule an inline React layer breaks, stated once so every error reads the same. */
export const REACT_LAYER_RULE =
	`React layers must be file layers: ${REACT_LAYER_MIME_TYPES.join(' and ')} name a composition module by path, ` +
	'so an inline layer cannot declare one';

/**
 * One MIME type as a case-insensitive regular-expression alternative: each
 * letter becomes a two-letter class and every other character is escaped.
 */
export function caseInsensitiveAlternative(value: string): string {
	return [...value]
		.map((character) =>
			/[a-z]/i.test(character)
				? `[${character.toLowerCase()}${character.toUpperCase()}]`
				: character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
		)
		.join('');
}

/**
 * The exclusion as a JSON Schema `pattern`, matching the predicate's case rule.
 *
 * A Zod refinement validates and then vanishes from the generated schema, so the
 * rule is attached as a keyword too. It is a pattern rather than an `enum`
 * because an enum would compare case-sensitively and let `TEXT/TSX` through the
 * published schema while the framework rejected it.
 */
export const REACT_LAYER_MIME_PATTERN = mimeTypesPattern(REACT_LAYER_MIME_TYPES);

/**
 * A lower-case MIME list as one case-insensitive JSON Schema `pattern`:
 * `^A$` for one type and `^(?:A|B|C)$` for several, where each alternative is
 * {@link caseInsensitiveAlternative}. The release guard parses this exact
 * production back into a MIME set, so every MIME rule is stated through it.
 */
export function mimeTypesPattern(mimeTypes: readonly string[]): string {
	const alternatives = mimeTypes.map(caseInsensitiveAlternative);
	return alternatives.length === 1 ? `^${alternatives[0]}$` : `^(?:${alternatives.join('|')})$`;
}

/**
 * Common fields shared by all layer types.
 */
const LayerBaseSchema = z.object({
	mimeType: z.string()
		.min(1)
		.max(100)
		.describe('MIME type of the layer content (e.g., text/markdown, application/pdf)'),
	title: z.string()
		.min(1)
		.max(200)
		.describe('Human-readable title for this layer')
		.optional(),
	description: z.string()
		.min(1)
		.max(2000)
		.describe('Description of what this layer represents')
		.optional(),
	signatures: z.record(
		z.string().min(1).max(100).describe('Slot ID'),
		SignatureSlotSchema,
	).describe('Signature slots keyed by slot id')
		.optional(),
});

/** The rule a font on a layer other than a PDF breaks, stated once so every error reads the same. */
export const LAYER_FONT_RULE = 'Only PDF layers (application/pdf) can declare a font';

/** The rule bindings on a layer other than a PDF break, stated once so every error reads the same. */
export const LAYER_BINDINGS_RULE = 'Only PDF layers (application/pdf) can declare bindings; other templates name values as {{fields.fieldName}}';

/** Whether a layer's MIME type names a PDF, the only layer type that takes bindings. */
export function isPdfMimeType(mimeType: string): boolean {
	return mimeType.toLowerCase() === 'application/pdf';
}

/** The DOCX MIME type. */
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Whether a layer's MIME type names a DOCX template. Case-insensitive, as every MIME check here is. */
export function isDocxMimeType(mimeType: string): boolean {
	return mimeType.toLowerCase() === DOCX_MIME_TYPE;
}

/** The MIME types of text templates: layers whose text is a template the text renderer fills. */
export const TEXT_TEMPLATE_MIME_TYPES = ['text/plain', 'text/markdown', 'text/html'] as const;

/** Whether a layer's MIME type names a text template. Case-insensitive, as every MIME check here is. */
export function isTextTemplateMimeType(mimeType: string): boolean {
	return (TEXT_TEMPLATE_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/** The MIME types of PDF layers, the only layers that take a font or bindings. */
export const PDF_LAYER_MIME_TYPES = ['application/pdf'] as const;

/**
 * The MIME types of every layer kind that prints values, the layers that can
 * declare a `format`: PDF, the text templates, DOCX, and React compositions.
 * The list is explicit, so a future layer kind that prints no values refuses
 * a format until it is added here.
 */
export const FORMAT_LAYER_MIME_TYPES = [
	'application/pdf',
	...TEXT_TEMPLATE_MIME_TYPES,
	DOCX_MIME_TYPE,
	...REACT_LAYER_MIME_TYPES,
] as const;

/** Whether a layer's MIME type names a layer kind that prints values. Case-insensitive, as every MIME check here is. */
export function isFormatLayerMimeType(mimeType: string): boolean {
	return (FORMAT_LAYER_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/** The rule a format on a layer that prints no values breaks, stated once so every error reads the same. */
export const LAYER_FORMAT_RULE = `Only layers that print values can declare a format: ${FORMAT_LAYER_MIME_TYPES.join(', ')}`;

/**
 * How a layer presents money values. `currencyDisplay` keeps its meaning;
 * every choice the format leaves out stays with the formatter.
 */
const LayerMoneyFormatSchema = z.object({
	currencyDisplay: z.literal('none')
		.describe('`none` prints the amount without a currency symbol or code, for a template that pre-prints the symbol beside each money box')
		.optional(),
}).strict().meta({
	title: 'LayerMoneyFormat',
	description: 'How a layer or binding presents money values',
});

/**
 * How a layer prints calendar dates, for a template that asks for one
 * numeric order such as mm/dd/yyyy.
 */
const LayerDateFormatSchema = z.object({
	pattern: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'])
		.describe('Numeric order the template asks for: two-digit month and day, four-digit year'),
}).strict().meta({
	title: 'LayerDateFormat',
	description: 'How a layer or binding presents date values',
});

/** How a layer or binding prints phone numbers; the extension prints as with `e164`. */
const LayerPhoneFormatSchema = z.object({
	style: z.enum(['e164', 'international', 'national', 'digits'])
		.describe('`e164` prints the stored number (+12125551234); `international` (+1 212 555 1234) and `national` ((212) 555-1234) use the numbering plan\'s layout; `digits` prints the national significant number with no trunk prefix or punctuation (2125551234)')
		.optional(),
	region: z.string()
		.regex(/^[A-Z]{2}$/)
		.describe('ISO 3166-1 alpha-2 region whose numbering plan a national box expects, such as US. Under `national` and `digits`, a number with another country calling code is refused; reading those styles back needs it')
		.optional(),
}).strict().meta({
	title: 'LayerPhoneFormat',
	description: 'How a layer or binding presents phone numbers',
});

/** How a layer or binding prints `enum` and `multiselect` values in text. */
const LayerChoiceFormatSchema = z.object({
	display: z.enum(['label', 'value'])
		.describe('`label` prints each option\'s label, `value` its value. Checkboxes, radio buttons and dropdowns always take option values')
		.optional(),
}).strict().meta({
	title: 'LayerChoiceFormat',
	description: 'How a layer or binding presents choices in text',
});

/** How a layer or binding prints `boolean` values in text. */
const LayerBooleanFormatSchema = z.object({
	trueLabel: z.string()
		.max(200)
		.describe('Text printed for true, in place of the locale\'s word')
		.optional(),
	falseLabel: z.string()
		.max(200)
		.describe('Text printed for false, in place of the locale\'s word')
		.optional(),
}).strict().meta({
	title: 'LayerBooleanFormat',
	description: 'How a layer or binding presents booleans in text. Checkboxes always take the boolean',
});

/** A BCP 47 language tag: a language subtag, then hyphen-separated subtags. */
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * How values print: on a layer, over the formatter the caller renders with,
 * and on a PDF binding, over its layer's format. Every key is optional and
 * merges per kind and per property, so a binding's `money` keeps the layer's
 * other money choices.
 */
export const FormatSchema = z.object({
	locale: z.string()
		.min(2)
		.max(35)
		.regex(LOCALE_PATTERN)
		.describe('BCP 47 locale for names and words, such as en-US. It replaces the locale of the level below')
		.optional(),
	money: LayerMoneyFormatSchema.optional(),
	date: LayerDateFormatSchema.optional(),
	phone: LayerPhoneFormatSchema.optional(),
	choice: LayerChoiceFormatSchema.optional(),
	boolean: LayerBooleanFormatSchema.optional(),
}).strict().meta({
	title: 'LayerFormat',
	description: 'How values print, applied over the caller\'s formatter on a layer and over the layer\'s format on a PDF binding',
});

/**
 * One PDF binding written as an object: the binding text it would be as a
 * string, and the format its value prints with.
 */
export const PdfBindingObjectSchema = z.object({
	path: z.string()
		.min(1)
		.max(500)
		.describe('Asterdoc path whose value fills the field, written as a string binding is (e.g., fields.dob, ssn:2, city, state)'),
	format: FormatSchema
		.describe('How this binding\'s value prints, merged over the layer\'s format. A joined path applies it to each value before the join. Not on an option test such as status:married')
		.optional(),
}).strict().meta({
	title: 'PdfBinding',
	description: 'A PDF binding with its own format',
});

/**
 * A PDF layer's bindings: each key is a fully qualified AcroForm field name in
 * the template, and each value is the Asterdoc path that fills it, as a string
 * or as a binding object that also carries a format.
 */
export const PdfBindingsSchema = z.record(
	z.string().min(1).max(500).describe('AcroForm field name in the PDF template, fully qualified (e.g., topmostSubform[0].Page1[0].f1_01[0])'),
	z.union([
		z.string().min(1).max(500).describe('Asterdoc path whose value fills the field (e.g., fields.name, parties.buyer.name)'),
		PdfBindingObjectSchema,
	]),
).describe('PDF layers only. Maps each AcroForm field name (key) to the Asterdoc path (value) that fills it');

/** A PDF layer that reuses a sibling PDF layer's bindings. */
export const PdfBindingsFromSchema = z.string()
	.min(1)
	.max(128)
	.describe('PDF layers only. Key of a sibling PDF layer whose bindings this layer reuses');

/**
 * The layer keys only some layer kinds can declare, each with the lower-case
 * MIME types that can declare it.
 */
export const LAYER_KEY_MIME_TYPES = {
	font: PDF_LAYER_MIME_TYPES,
	format: FORMAT_LAYER_MIME_TYPES,
	bindings: PDF_LAYER_MIME_TYPES,
	bindingsFrom: PDF_LAYER_MIME_TYPES,
} as const satisfies Record<string, readonly string[]>;

/** A layer key that only some layer kinds can declare. */
export type MimeRestrictedLayerKey = keyof typeof LAYER_KEY_MIME_TYPES;

/** The layer keys only some layer kinds can declare, in the order their rules are stated. */
export const MIME_RESTRICTED_LAYER_KEYS = Object.keys(LAYER_KEY_MIME_TYPES) as MimeRestrictedLayerKey[];

/**
 * The MIME rule of each layer key, stated to JSON Schema as well as at
 * runtime: a refinement alone would vanish from the published schema.
 */
export function layerKeyRulesJsonSchema(keys: readonly MimeRestrictedLayerKey[] = MIME_RESTRICTED_LAYER_KEYS) {
	return keys.map((key) => ({
		if: { required: [key] },
		then: { properties: { mimeType: { pattern: mimeTypesPattern(LAYER_KEY_MIME_TYPES[key]) } } },
	}));
}

/**
 * A font a PDF layer draws filled values and overlay text with, read through
 * the same resolver as the layer's PDF.
 */
const LayerFontSchema = z.object({
	path: z.string()
		.min(1)
		.max(1000)
		.describe('Logical resolver path of a TrueType-outline font program (.ttf), resolved like the layer path'),
	checksum: ChecksumSchema.optional(),
}).strict().meta({
	title: 'LayerFont',
	description: 'Font a PDF layer draws filled values and overlay text with',
});

/**
 * The file layer's keys, before its layer key rules. The registry file layer
 * extends it, so the two describe one layer.
 */
export const FileLayerObjectSchema = LayerBaseSchema.extend({
	kind: z.literal('file'),
	path: z.string()
		.min(1)
		.max(1000)
		.describe('Logical resolver path; the CLI resolves file-backed artifacts from their directory and stdin artifacts from cwd'),
	checksum: ChecksumSchema.optional(),
	font: LayerFontSchema
		.describe('Font for filled values and overlay text; PDF layers only. It is tried after a font supplied at render time and before the form\'s own fonts')
		.optional(),
	format: FormatSchema
		.describe('How the layer prints values, over the caller\'s formatter; layers that print values only. It applies to this layer alone, not to a layer that reuses its bindings')
		.optional(),
	bindings: PdfBindingsSchema.optional(),
	bindingsFrom: PdfBindingsFromSchema.optional(),
}).strict();

type MimeRestrictedLayer = { mimeType: string } & Partial<Record<MimeRestrictedLayerKey, unknown>>;

/**
 * Apply each layer key's MIME rule to a layer object schema: a key a layer's
 * MIME type cannot declare is refused, naming the rule.
 */
export function withLayerKeyRules<T extends z.ZodType<MimeRestrictedLayer>>(schema: T) {
	return schema.refine(
		(layer) => layer.font === undefined || isPdfMimeType(layer.mimeType),
		{ error: LAYER_FONT_RULE, path: ['font'] },
	).refine(
		(layer) => layer.format === undefined || isFormatLayerMimeType(layer.mimeType),
		{ error: LAYER_FORMAT_RULE, path: ['format'] },
	).refine(
		(layer) => layer.bindings === undefined || isPdfMimeType(layer.mimeType),
		{ error: LAYER_BINDINGS_RULE, path: ['bindings'] },
	).refine(
		(layer) => layer.bindingsFrom === undefined || isPdfMimeType(layer.mimeType),
		{ error: LAYER_BINDINGS_RULE, path: ['bindingsFrom'] },
	);
}

/**
 * Inline layer — content embedded directly in the artifact definition.
 */
const InlineLayerSchema = withLayerKeyRules(LayerBaseSchema.extend({
	kind: z.literal('inline'),
	// The exclusion is stated to JSON Schema as well as to Zod: a refinement
	// alone would validate at runtime and vanish from the published schema.
	mimeType: z.string()
		.min(1)
		.max(100)
		.refine((value) => !isReactLayerMimeType(value), { error: REACT_LAYER_RULE })
		.describe('MIME type of the layer content (e.g., text/markdown). Never a React composition type')
		.meta({ not: { pattern: REACT_LAYER_MIME_PATTERN } }),
	text: z.string()
		.min(1)
		.max(1000000)
		.describe('Layer content with interpolation placeholders (e.g., {{fields.fieldName}})'),
	format: FormatSchema
		.describe('How the layer prints values, over the caller\'s formatter; layers that print values only')
		.optional(),
}).strict().meta({
	title: 'InlineLayer',
	description: 'Inline layer with embedded content',
}));

/**
 * File layer — references external content through a resolver-defined path.
 */
const FileLayerSchema = withLayerKeyRules(FileLayerObjectSchema.meta({
	title: 'FileLayer',
	description: 'File-backed layer with path reference',
}));

/**
 * Union of all layer types.
 */
export const LayerSchema = z.discriminatedUnion('kind', [
	InlineLayerSchema,
	FileLayerSchema,
]).meta({
	title: 'Layer',
	description: 'Layer specification — inline content or file reference',
	allOf: layerKeyRulesJsonSchema(),
});

/** The rule a React layer on a document or checklist breaks, stated once so every error reads the same. */
export const REACT_LAYER_FORM_ONLY_RULE =
	`Only a form can declare a React layer: a composition renders a form and its data, so a document or checklist layer cannot be ${REACT_LAYER_MIME_TYPES.join(' or ')}`;

/**
 * Apply the React layer's form-only rule to a document's or checklist's
 * layers. The rule is stated to JSON Schema as well as at runtime, so a
 * consumer validating against the published schema rejects the same layers.
 */
export function withoutReactLayers<T extends z.ZodType<Record<string, { mimeType: string }>>>(layers: T) {
	return layers.superRefine((value, ctx) => {
		for (const [key, layer] of Object.entries(value)) {
			if (isReactLayerMimeType(layer.mimeType)) {
				ctx.addIssue({ code: 'custom', path: [key, 'mimeType'], message: REACT_LAYER_FORM_ONLY_RULE });
			}
		}
	}).meta({
		allOf: [{
			additionalProperties: {
				not: { properties: { mimeType: { pattern: REACT_LAYER_MIME_PATTERN } }, required: ['mimeType'] },
			},
		}],
	});
}
