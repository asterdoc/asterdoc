import { defaultFormatter } from "@asterdoc/format";
import { formatFieldOptions, formatProblem, formatterFor, type ModifierTarget } from "@asterdoc/render";
import { ValueFormatSchema } from "@asterdoc/schemas";
import type { FormField, Formatter, FormatterProgressivePolicy, LayerFormat, ValueFormat } from "@asterdoc/types";
import { formatFieldValue, formatDefinitionValue } from "@asterdoc/render/text/field-formatter";
import { CompositeFieldPathError } from "./fields";
export { ArtifactFieldFormatError } from "@asterdoc/render/text/field-formatter";

export const BLANK = "—";

export interface FormatOptions {
  formatter?: Formatter;
  blank?: string;
  /** Opt into placeholders for missing and incomplete values while filling. */
  partial?: boolean;
  progressive?: FormatterProgressivePolicy;
  /**
   * How every value of the document prints, as a layer's `format` declares it.
   * It merges per kind and per property over the presentation the document
   * inherits (a React layer's `format`), and under each element's own `format`.
   */
  presentation?: LayerFormat;
}

/**
 * Formats one field value. `format` is the effective format, merged from every
 * level; it defaults to the document's presentation.
 */
export type ValueFormatter = (field: FormField | undefined, value: unknown, location?: string, format?: ValueFormat) => string;

export interface DocumentFormatter {
  format: ValueFormatter;
  formatter: Formatter;
  blank: string;
  partial: boolean;
  progressive?: FormatterProgressivePolicy;
  /** The document's presentation: the inherited layer format under the document's own. */
  presentation?: LayerFormat;
}

/**
 * Formats a value by its declared type, as a computed definition or an annex
 * prints. `format` is the effective format, merged from every level.
 */
export function formatByType(
  type: string | undefined,
  value: unknown,
  formatter: Formatter = defaultFormatter,
  blank: string = BLANK,
  location?: string,
  progressive?: FormatterProgressivePolicy,
  format?: ValueFormat,
): string {
  const formatted = formatDefinitionValue(
    formatterFor(formatter, format),
    type ?? "string",
    value,
    location ?? type ?? "value",
    formatFieldOptions(format, { progressive })
  );
  return formatted == null ? blank : String(formatted);
}

export function createValueFormatter(options: FormatOptions = {}): DocumentFormatter {
  const formatter = options.formatter ?? defaultFormatter;
  const blank = options.blank ?? BLANK;
  const partial = options.partial ?? false;
  const progressive = options.progressive ?? (partial ? { missing: blank, incomplete: blank } : undefined);
  const presentation = options.presentation;
  const format: ValueFormatter = (field, value, location, effective = presentation) => {
    const path = location ?? field?.label ?? field?.type ?? "value";
    // A composite has no one value; `String(...)` on it would print `[object Object]`.
    if (field?.type === "fieldset" || field?.type === "list") throw new CompositeFieldPathError(path, field.type);
    const formatted = formatFieldValue(
      formatterFor(formatter, effective),
      field ?? { type: "text" } as FormField,
      value,
      path,
      formatFieldOptions(effective, { progressive })
    );
    return formatted == null ? blank : String(formatted);
  };
  return { format, formatter, blank, partial, progressive, presentation };
}

/**
 * Raised when an element's `format` is malformed, or sets a key that changes
 * none of the values the element prints. A composition check reports it as
 * `format:<path>` instead.
 */
export class ElementFormatError extends Error {
  constructor(readonly path: string, readonly problems: readonly string[]) {
    super(`The format at "${path}" is not valid: ${problems.join("; ")}.`);
    this.name = "ElementFormatError";
  }
}

/**
 * What is wrong with an element's `format`: shape problems first, then what
 * template format modifiers refuse, by the same rules: a value a key does not
 * take, or a key that applies to none of `targets`, the values the element
 * prints. With no declared targets to judge by, only keys and values are
 * checked.
 */
export function elementFormatProblems(format: unknown, targets: readonly ModifierTarget[]): string[] {
  const parsed = ValueFormatSchema.safeParse(format);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message
    );
  }
  const problem = formatProblem(parsed.data, targets);
  return problem === undefined ? [] : [problem.replace(/\.$/, "")];
}

/** A serialization of `value` with object keys sorted, so equal formats share one key. */
export function canonicalFormatKey(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) => {
    if (member === null || typeof member !== "object" || Array.isArray(member)) return member;
    const record = member as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  }) ?? "";
}
