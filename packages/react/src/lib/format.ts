import { defaultFormatter } from "@asterdoc/format";
import type { FormField, Formatter, FormatterProgressivePolicy } from "@asterdoc/types";
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
}

export type ValueFormatter = (field: FormField | undefined, value: unknown, location?: string) => string;

export interface DocumentFormatter {
  format: ValueFormatter;
  formatter: Formatter;
  blank: string;
  partial: boolean;
  progressive?: FormatterProgressivePolicy;
}

export function formatByType(
  type: string | undefined,
  value: unknown,
  formatter: Formatter = defaultFormatter,
  blank: string = BLANK,
  location?: string,
  progressive?: FormatterProgressivePolicy,
): string {
  const formatted = formatDefinitionValue(formatter, type ?? "string", value, location ?? type ?? "value", { progressive });
  return formatted == null ? blank : String(formatted);
}

export function createValueFormatter(options: FormatOptions = {}): DocumentFormatter {
  const formatter = options.formatter ?? defaultFormatter;
  const blank = options.blank ?? BLANK;
  const partial = options.partial ?? false;
  const progressive = options.progressive ?? (partial ? { missing: blank, incomplete: blank } : undefined);
  const format: ValueFormatter = (field, value, location) => {
    const path = location ?? field?.label ?? field?.type ?? "value";
    // A composite has no one value; `String(...)` on it would print `[object Object]`.
    if (field?.type === "fieldset" || field?.type === "list") throw new CompositeFieldPathError(path, field.type);
    const formatted = formatFieldValue(formatter, field ?? { type: "text" } as FormField, value, path, { progressive });
    return formatted == null ? blank : String(formatted);
  };
  return { format, formatter, blank, partial, progressive };
}
