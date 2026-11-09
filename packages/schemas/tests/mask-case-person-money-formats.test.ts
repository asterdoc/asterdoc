import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FormFieldSchema, MASK_PATTERN, MaskSchema } from "../src/zod";
import { FormatSchema, LayerSchema, ValueFormatSchema } from "../src/zod/artifacts/shared/layer";

describe("a text field mask", () => {
  it("accepts a mask with a token, literals and escapes", () => {
    for (const mask of ["###-##-####", "##-#######", "A-#########", "\\#-***", "@@ @@"]) {
      expect(FormFieldSchema.safeParse({ type: "text", mask }).success, mask).toBe(true);
    }
  });

  it("refuses a mask without a token, with a trailing escape, outside ASCII, or empty", () => {
    for (const mask of ["A-B", "\\#", "##\\", "##é", ""]) {
      expect(FormFieldSchema.safeParse({ type: "text", mask }).success, mask).toBe(false);
    }
  });

  it("is a property of text fields only", () => {
    expect(FormFieldSchema.safeParse({ type: "email", mask: "###" }).success).toBe(false);
    expect(FormFieldSchema.safeParse({ type: "uuid", mask: "###" }).success).toBe(false);
  });

  it("states the same mask rule in JSON Schema", () => {
    const json = z.toJSONSchema(MaskSchema) as unknown as { pattern: string };
    expect(json.pattern).toBe(MASK_PATTERN.source);
    const pattern = new RegExp(json.pattern);
    expect(pattern.test("###-##-####")).toBe(true);
    expect(pattern.test("A-B")).toBe(false);
    expect(pattern.test("##\\")).toBe(false);
  });
});

describe("format keys for case, person, text and money", () => {
  it("accepts every value the keys take", () => {
    for (const format of [
      { case: "upper" },
      { case: "none" },
      { person: { order: "family-first" } },
      { person: { order: "given-first" } },
      { text: { mask: true } },
      { text: { mask: false } },
      { money: { fractionDigits: 0 } },
      { money: { fractionDigits: 2, useGrouping: false } },
      { money: { currencyDisplay: "none", fractionDigits: 0 } },
    ]) {
      expect(FormatSchema.safeParse(format).success, JSON.stringify(format)).toBe(true);
    }
  });

  it("refuses values outside each key's set", () => {
    for (const format of [
      { case: "lower" },
      { case: "title" },
      { person: { order: "surname" } },
      { person: { style: "formal" } },
      { text: { mask: "A-B" } },
      { text: { mask: 1 } },
      { money: { fractionDigits: 1 } },
      { money: { fractionDigits: 3 } },
      { money: { useGrouping: "no" } },
    ]) {
      expect(FormatSchema.safeParse(format).success, JSON.stringify(format)).toBe(false);
    }
  });
});

describe("a mask string in a format", () => {
  const pdf = (extra: Record<string, unknown>) => ({ kind: "file", mimeType: "application/pdf", path: "form.pdf", ...extra });

  it("is refused on a layer, which takes only true or false", () => {
    expect(FormatSchema.safeParse({ text: { mask: "###-##-####" } }).success).toBe(false);
    expect(LayerSchema.safeParse(pdf({ format: { text: { mask: "###-##-####" } } })).success).toBe(false);
    expect(LayerSchema.safeParse({ kind: "inline", mimeType: "text/plain", text: "x", format: { text: { mask: "###" } } }).success).toBe(false);
    expect(LayerSchema.safeParse(pdf({ format: { text: { mask: false } } })).success).toBe(true);
  });

  it("is accepted on a binding, with every layer option", () => {
    expect(ValueFormatSchema.safeParse({ text: { mask: "###-##-####" }, case: "upper", money: { fractionDigits: 0 } }).success).toBe(true);
    expect(ValueFormatSchema.safeParse({ text: { mask: "A-B" } }).success).toBe(false);
    const bindings = { f1: { path: "fields.ssn", format: { text: { mask: "### ## ####" } } } };
    expect(LayerSchema.safeParse(pdf({ bindings })).success).toBe(true);
  });

  it("is stated in JSON Schema, so the published schema refuses it on a layer", () => {
    const layer = z.toJSONSchema(FormatSchema) as unknown as { properties: { text: { properties: { mask: { type?: string } } } } };
    expect(layer.properties.text.properties.mask.type).toBe("boolean");
    const value = z.toJSONSchema(ValueFormatSchema) as unknown as { properties: { text: { properties: { mask: { anyOf?: unknown[] } } } } };
    expect(value.properties.text.properties.mask.anyOf).toHaveLength(2);
  });
});
