import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  caseInsensitiveAlternative,
  DOCX_MIME_TYPE,
  FORMAT_LAYER_MIME_TYPES,
  FormatSchema,
  LAYER_FORMAT_RULE,
  LAYER_KEY_MIME_TYPES,
  LayerSchema,
  mimeTypesPattern,
  PdfBindingsSchema,
} from "../src/zod/artifacts/shared/layer";
import { RegistryInlineLayerSchema, RegistryLayerSchema } from "../src/zod/registry/registry-item";

const pdfLayer = (format: unknown) => ({
  kind: "file",
  mimeType: "application/pdf",
  path: "1099-nec-A.pdf",
  format,
});

const messages = (result: { success: boolean; error?: { issues: Array<{ message: string; path: PropertyKey[] }> } }) =>
  result.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? [];

const printingLayers = [
  ["PDF", "application/pdf", "form.pdf"],
  ["plain text", "text/plain", "notice.txt"],
  ["Markdown", "text/markdown", "notice.md"],
  ["HTML", "text/html", "notice.html"],
  ["DOCX", DOCX_MIME_TYPE, "notice.docx"],
  ["TSX", "text/tsx", "notice.tsx"],
  ["JSX", "text/jsx", "notice.jsx"],
] as const;

const dateFormat = { date: { pattern: "MM/DD/YYYY" } };

type JsonRule = { if?: { required?: string[] }; then?: { properties?: { mimeType?: { pattern?: string } } } };

function jsonRule(schema: z.ZodType, key: string): { pattern: string; rule: RegExp } {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as unknown as { allOf?: JsonRule[] };
  const rules = json.allOf?.filter((entry) => entry.if?.required?.includes(key)) ?? [];
  expect(rules).toHaveLength(1);
  const pattern = rules[0]!.then!.properties!.mimeType!.pattern!;
  return { pattern, rule: new RegExp(pattern) };
}

describe("a layer's format", () => {
  it.each(printingLayers)("a %s file layer takes one", (_label, mimeType, path) => {
    expect(messages(LayerSchema.safeParse({ kind: "file", mimeType, path, format: dateFormat }))).toEqual([]);
    expect(messages(LayerSchema.safeParse({ kind: "file", mimeType: mimeType.toUpperCase(), path, format: dateFormat }))).toEqual([]);
  });

  it.each(["text/plain", "text/markdown", "text/html"])("an inline %s layer takes one", (mimeType) => {
    const result = LayerSchema.safeParse({ kind: "inline", mimeType, text: "{{fields.dob}}", format: dateFormat });
    expect(messages(result)).toEqual([]);
    expect(result.data).toMatchObject({ format: dateFormat });
  });

  it("accepts mixed-case MIME types", () => {
    for (const mimeType of ["APPLICATION/PDF", "Text/Markdown", "Application/Vnd.OpenXmlFormats-OfficeDocument.WordprocessingML.Document"]) {
      expect(messages(LayerSchema.safeParse({ kind: "file", mimeType, path: "x", format: dateFormat }))).toEqual([]);
    }
  });

  it("refuses one on a layer that prints no values, naming the rule", () => {
    for (const layer of [
      { kind: "file", mimeType: "application/json", path: "data.json", format: dateFormat },
      { kind: "file", mimeType: "image/png", path: "logo.png", format: dateFormat },
      { kind: "inline", mimeType: "application/json", text: "{}", format: dateFormat },
    ]) {
      expect(messages(LayerSchema.safeParse(layer))).toContain(`format: ${LAYER_FORMAT_RULE}`);
    }
  });

  it("names every MIME type that can declare one in its rule", () => {
    for (const mimeType of FORMAT_LAYER_MIME_TYPES) expect(LAYER_FORMAT_RULE).toContain(mimeType);
  });

  it("lets money print without a currency symbol, and leaves currencyDisplay optional", () => {
    expect(LayerSchema.safeParse(pdfLayer({ money: { currencyDisplay: "none" } })).success).toBe(true);
    expect(LayerSchema.safeParse(pdfLayer({ money: {} })).success).toBe(true);
    for (const currencyDisplay of ["symbol", "code", "name", "narrowSymbol"]) {
      expect(LayerSchema.safeParse(pdfLayer({ money: { currencyDisplay } })).success).toBe(false);
    }
  });

  it("prints dates in the numeric order a template asks for, and refuses any other", () => {
    for (const pattern of ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]) {
      expect(LayerSchema.safeParse(pdfLayer({ date: { pattern } })).success).toBe(true);
    }
    for (const pattern of ["MM/DD/YY", "mm/dd/yyyy", "D MMMM YYYY"]) {
      expect(LayerSchema.safeParse(pdfLayer({ date: { pattern } })).success).toBe(false);
    }
    expect(LayerSchema.safeParse(pdfLayer({ date: {} })).success).toBe(false);
    const extra = LayerSchema.safeParse(pdfLayer({ date: { pattern: "MM/DD/YYYY", separator: "-" } }));
    expect(messages(extra).join("\n")).toContain("separator");
  });

  it("takes a BCP 47 locale and refuses text that is not one", () => {
    for (const locale of ["en", "en-US", "fr-CA", "zh-Hant-TW"]) {
      expect(FormatSchema.safeParse({ locale }).success, locale).toBe(true);
    }
    for (const locale of ["", "e", "en_US", "en US", "-US", "english-language-tag"]) {
      expect(FormatSchema.safeParse({ locale }).success, locale).toBe(false);
    }
  });

  it("refuses keys it does not declare, by name", () => {
    const money = LayerSchema.safeParse(pdfLayer({ money: { currencyDisplay: "none", minimumFractionDigits: 2 } }));
    expect(messages(money).join("\n")).toContain("minimumFractionDigits");
    const format = LayerSchema.safeParse(pdfLayer({ number: { useGrouping: false } }));
    expect(messages(format).join("\n")).toContain("number");
  });
});

describe("a binding object", () => {
  it("takes a path and a format, beside string bindings", () => {
    const bindings = { f1: "fields.name", f2: { path: "fields.dob", format: dateFormat }, f3: { path: "city, state" } };
    const result = PdfBindingsSchema.safeParse(bindings);
    expect(messages(result)).toEqual([]);
    expect(result.data).toEqual(bindings);
  });

  it("refuses a binding object without a path, with an empty path, or with an undeclared key", () => {
    expect(PdfBindingsSchema.safeParse({ f1: { format: dateFormat } }).success).toBe(false);
    expect(PdfBindingsSchema.safeParse({ f1: { path: "" } }).success).toBe(false);
    expect(messages(PdfBindingsSchema.safeParse({ f1: { path: "fields.dob", part: "year" } })).join("\n")).toContain("part");
    expect(PdfBindingsSchema.safeParse({ f1: { path: "fields.dob", format: { date: { pattern: "DD.MM.YYYY" } } } }).success).toBe(false);
  });

  it("is refused on a layer that is not a PDF, as any binding is", () => {
    const result = LayerSchema.safeParse({ kind: "file", mimeType: "text/markdown", path: "n.md", bindings: { f1: { path: "fields.dob" } } });
    expect(result.success).toBe(false);
  });
});

describe("a registry layer's format", () => {
  it("is kept on a registry inline layer of a printing type, and refused on one that prints nothing", () => {
    const inline = { kind: "inline", mimeType: "text/markdown", text: "{{fields.dob}}", format: dateFormat };
    expect(RegistryInlineLayerSchema.safeParse(inline).data).toMatchObject({ format: dateFormat });
    expect(RegistryLayerSchema.safeParse(inline).data).toMatchObject({ format: dateFormat });
    expect(messages(RegistryLayerSchema.safeParse({ ...inline, mimeType: "application/json" }))).toContain(`format: ${LAYER_FORMAT_RULE}`);
  });

  it("is kept on a registry DOCX file layer", () => {
    const layer = { kind: "file", mimeType: DOCX_MIME_TYPE, path: "n.docx", url: "https://registry.example.com/n.docx", format: dateFormat };
    expect(messages(RegistryLayerSchema.safeParse(layer))).toEqual([]);
  });
});

describe("the MIME rules in the published JSON Schema", () => {
  it("states the format rule once, as the grouped pattern of its MIME list", () => {
    for (const schema of [LayerSchema, RegistryLayerSchema]) {
      const { pattern, rule } = jsonRule(schema, "format");
      expect(pattern).toBe(mimeTypesPattern(FORMAT_LAYER_MIME_TYPES));
      expect(pattern.startsWith("^(?:")).toBe(true);
      for (const mimeType of FORMAT_LAYER_MIME_TYPES) {
        expect(rule.test(mimeType)).toBe(true);
        expect(rule.test(mimeType.toUpperCase())).toBe(true);
      }
      expect(rule.test("APPLICATION/PDF")).toBe(true);
      expect(rule.test("application/json")).toBe(false);
      expect(rule.test("text/markdownx")).toBe(false);
      expect(rule.test(DOCX_MIME_TYPE.replace(/\./g, "x"))).toBe(false);
    }
  });

  it("keeps the ungrouped one-type pattern for the PDF-only keys", () => {
    for (const key of ["font", "bindings", "bindingsFrom"] as const) {
      const { pattern, rule } = jsonRule(LayerSchema, key);
      expect(LAYER_KEY_MIME_TYPES[key]).toEqual(["application/pdf"]);
      expect(pattern).toBe(`^${caseInsensitiveAlternative("application/pdf")}$`);
      expect(rule.test("Application/PDF")).toBe(true);
      expect(rule.test("text/markdown")).toBe(false);
    }
  });

  it("writes each alternative case-insensitively and escapes the DOCX type's dots", () => {
    expect(caseInsensitiveAlternative("text/x.y")).toBe("[tT][eE][xX][tT]/[xX]\\.[yY]");
    expect(mimeTypesPattern(["a/b"])).toBe("^[aA]/[bB]$");
    expect(mimeTypesPattern(["a/b", "c/d"])).toBe("^(?:[aA]/[bB]|[cC]/[dD])$");
  });

  it("states a binding value as the old string schema or a binding object", () => {
    const json = z.toJSONSchema(PdfBindingsSchema, { target: "draft-2020-12" }) as unknown as {
      additionalProperties: { anyOf: Array<{ type?: string; description?: string; required?: string[] }> };
    };
    const [text, object] = json.additionalProperties.anyOf;
    expect(text).toEqual({ type: "string", minLength: 1, maxLength: 500, description: "Asterdoc path whose value fills the field (e.g., fields.name, parties.buyer.name)" });
    expect(object).toMatchObject({ type: "object", required: ["path"] });
  });
});
