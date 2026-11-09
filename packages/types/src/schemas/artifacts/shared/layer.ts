/**
 * Layer types for artifact rendering
 */

/**
 * Field type for a signature slot. Mirrors SigningFieldType.
 */
export type SignatureSlotType = 'signature' | 'initials' | 'date_signed' | 'capacity' | 'printed_name';

/**
 * Where a signature slot lands in the sealed PDF.
 * - 'flow': the field sits where the template content places it — the render
 *   stage injects an invisible marker at the slot's placeholder and the
 *   placement stage locates it after conversion.
 * - absolute: fixed coordinates known at design time (PDF templates).
 * - anchor: found by literal document text after conversion; text must be
 *   unique unless `occurrence` picks a match (1-based, reading order).
 */
export type SignatureSlotPlacement =
  | 'flow'
  | { page: number; x: number; y: number; width: number; height: number }
  | {
      anchor: { text: string; offsetX?: number; offsetY?: number; occurrence?: number };
      width: number;
      height: number;
    };

/**
 * Signature slot: one signing field on a layer, keyed by slot id.
 */
export interface SignatureSlot {
  /** Party this slot binds to. index is 0-based for multi-party roles (default 0). */
  party: { role: string; index?: number };
  /** Type of signing field. */
  type: SignatureSlotType;
  /** Whether the slot must be signed. Defaults to true. */
  required?: boolean;
  /** Human-readable label. */
  label?: string;
  /** Placement specification. */
  placement: SignatureSlotPlacement;
}

/**
 * MIME types that name a React composition module.
 *
 * A composition is a React component in a `.tsx` or `.jsx` file. The layer that
 * declares one is a pointer to that module, so it is always a `FileLayer`: an
 * `InlineLayer` carrying one of these types is rejected at validation. Nothing
 * reads the file as content; the module is bound at render time.
 */
export type ReactLayerMimeType = 'text/tsx' | 'text/jsx';

/**
 * Inline layer with embedded text content.
 * Used for layers where content is stored directly in the artifact definition.
 */
export interface InlineLayer {
  /** Discriminator for inline layer type. */
  kind: "inline";
  /**
   * MIME type of the content (e.g., text/markdown, text/html).
   * Never a {@link ReactLayerMimeType}: a React layer names a module and must
   * be a {@link FileLayer}.
   */
  mimeType: string;
  /** Layer content with interpolation placeholders, such as `{{fields.fieldName}}`. */
  text: string;
  /** Optional human-readable title for this layer. */
  title?: string;
  /** Optional description of what this layer represents. */
  description?: string;
  /**
   * How the layer prints values, over the formatter the caller renders with.
   * Only layers that print values declare one.
   */
  format?: LayerFormat;
  /** Signature slots keyed by slot id. */
  signatures?: Record<string, SignatureSlot>;
}

/**
 * A font a PDF layer draws filled values and overlay text with.
 *
 * The font file is read through the same resolver as the layer's PDF, so it
 * travels with the artifact the same way. It must be a TrueType-outline font
 * program (.ttf).
 */
export interface LayerFont {
  /** Logical path passed unchanged to the bound resolver, like the layer's own path. */
  path: string;
  /** Optional SHA-256 checksum for integrity verification. */
  checksum?: string;
}

/**
 * How a layer or binding presents money values.
 *
 * Every choice left out stays with the level below: the layer's format under a
 * binding, the caller's formatter under a layer.
 */
export interface LayerMoneyFormat {
  /**
   * `none` prints the amount without a currency symbol or code, for a template
   * that pre-prints the symbol beside each money box.
   */
  currencyDisplay?: "none";
}

/** A numeric date order a template asks for. */
export type LayerDatePattern = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

/**
 * How a layer or binding presents date values, for a template that asks for
 * one numeric order such as mm/dd/yyyy.
 */
export interface LayerDateFormat {
  /** The order the template asks for: two-digit month and day, four-digit year. */
  pattern: LayerDatePattern;
}

/** How a phone number prints. */
export type LayerPhoneStyle = "e164" | "international" | "national" | "digits";

/** How a layer or binding presents phone numbers. The extension prints as with `e164`. */
export interface LayerPhoneFormat {
  /** `e164` as stored, `international`, `national`, or `digits` (the national significant number). */
  style?: LayerPhoneStyle;
  /**
   * ISO 3166-1 alpha-2 region whose numbering plan a national box expects.
   * Under `national` and `digits` a number with another calling code is
   * refused, and read-back of those styles needs it.
   */
  region?: string;
}

/** How a layer or binding presents `enum` and `multiselect` values in text. */
export interface LayerChoiceFormat {
  /** `label` prints each option's label, `value` its value. Checkboxes, radios and dropdowns always take values. */
  display?: "label" | "value";
}

/** How a layer or binding presents `boolean` values in text. */
export interface LayerBooleanFormat {
  /** Printed for true, in place of the locale's word. */
  trueLabel?: string;
  /** Printed for false, in place of the locale's word. */
  falseLabel?: string;
}

/**
 * How a layer or binding presents a country: an address's `country` member
 * or a `country` field. The value is normalized first; without this format it
 * prints as stored.
 */
export interface LayerCountryFormat {
  /** `code` prints the ISO 3166-1 alpha-2 code, `name` the country name in the format's locale. */
  display: "code" | "name";
}

/**
 * How a layer or binding presents a subdivision: an address's `region` member
 * or a `region` field. Without this format it prints as stored.
 */
export interface LayerRegionFormat {
  /** `code` prints the ISO 3166-2 code after the dash (`ON`), `full` the whole code (`CA-ON`), `name` its English name. */
  display: "code" | "name" | "full";
}

/**
 * How values print. On a layer it applies over the formatter the caller
 * renders with; on a PDF binding, over the layer's format. Levels merge per
 * kind and per property: a binding's `money` keeps the layer's other money
 * choices, and `locale` replaces the level below.
 */
export interface LayerFormat {
  /** BCP 47 locale for names and words, such as `en-US`. */
  locale?: string;
  /** How money values are presented. */
  money?: LayerMoneyFormat;
  /** How date values are presented. */
  date?: LayerDateFormat;
  /** How phone numbers are presented. */
  phone?: LayerPhoneFormat;
  /** How choices are presented in text. */
  choice?: LayerChoiceFormat;
  /** How booleans are presented in text. */
  boolean?: LayerBooleanFormat;
  /** How countries are presented. */
  country?: LayerCountryFormat;
  /** How subdivisions are presented. */
  region?: LayerRegionFormat;
}

/**
 * File-backed layer with external file reference.
 * Used for layers where content is stored in a separate file.
 */
export interface FileLayer {
  /** Discriminator for file layer type. */
  kind: "file";
  /**
   * MIME type of the file (e.g., application/pdf). A
   * {@link ReactLayerMimeType} declares a React composition.
   */
  mimeType: string;
  /**
   * Logical path passed unchanged to the bound resolver. The CLI resolves paths
   * from a file-backed artifact's directory, or from cwd for stdin artifacts;
   * custom resolvers define their own semantics.
   *
   * For a React layer it is a pointer to the composition module, never read as
   * content. Binding that module by import executes it, so a renderer that does
   * so confines the path to the artifact's own directory.
   */
  path: string;
  /** Optional human-readable title for this layer. */
  title?: string;
  /** Optional description of what this layer represents. */
  description?: string;
  /** Optional SHA-256 checksum for integrity verification. */
  checksum?: string;
  /**
   * Font for filled values and overlay text. PDF layers only. It is tried
   * after a font supplied at render time and before the form's own fonts.
   */
  font?: LayerFont;
  /**
   * How the layer prints values, over the formatter the caller renders with.
   * Only layers that print values declare one. It applies to this layer
   * alone; a layer that reuses these bindings through `bindingsFrom` declares
   * its own.
   */
  format?: LayerFormat;
  /**
   * PDF layers only. Maps each AcroForm field name in the template (key) to
   * the Asterdoc path that fills it (value), such as `fields.name`.
   */
  bindings?: Bindings;
  /** PDF layers only. Key of a sibling PDF layer whose bindings this layer reuses. */
  bindingsFrom?: string;
  /** Signature slots keyed by slot id. */
  signatures?: Record<string, SignatureSlot>;
}

/**
 * Layer specification - one of inline or file.
 * Layers are named renderings of content artifacts into specific formats.
 */
export type Layer = InlineLayer | FileLayer;

/**
 * One PDF binding written as an object: the binding text a string binding
 * would be, and the format its value prints with.
 */
export interface BindingObject {
  /** The Asterdoc path, in the binding language a string binding uses: `fields.dob`, `ssn:2`, `city, state`. */
  path: string;
  /**
   * How the value prints, merged over the layer's format. A joined path
   * applies it to each value before the join. An option test such as
   * `status:married` takes none.
   */
  format?: LayerFormat;
}

/** One PDF binding: a path string, or a binding object that also carries a format. */
export type BindingValue = string | BindingObject;

/**
 * A PDF layer's bindings: each key is a fully qualified AcroForm field name in
 * the template, and each value is the Asterdoc path that fills it, as a string
 * or a {@link BindingObject}.
 */
export type Bindings = Record<string, BindingValue>;
