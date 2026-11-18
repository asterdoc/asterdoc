import { describe, expect, it } from "vitest";
import { LayerSchema, PdfBindingsSchema } from "../src/zod";

const pdfLayer = (extra: Record<string, unknown>) => ({ kind: "file", mimeType: "application/pdf", path: "form.pdf", ...extra });

describe("a standard PDF font chosen in the artifact", () => {
  it("takes Helvetica or Courier for a PDF layer, beside a TrueType file", () => {
    expect(LayerSchema.safeParse(pdfLayer({ font: "Courier" })).success).toBe(true);
    expect(LayerSchema.safeParse(pdfLayer({ font: "Helvetica" })).success).toBe(true);
    expect(LayerSchema.safeParse(pdfLayer({ font: { path: "fonts/noto.ttf" } })).success).toBe(true);
  });

  it("takes Helvetica or Courier for a path or template binding", () => {
    expect(PdfBindingsSchema.safeParse({ ssn: { path: "ssn", font: "Courier" }, city: { template: "{{fields.city}}", font: "Helvetica" } }).success).toBe(true);
  });

  it("refuses another font name, and a font on a layer that is not a PDF", () => {
    expect(LayerSchema.safeParse(pdfLayer({ font: "Arial" })).success).toBe(false);
    expect(PdfBindingsSchema.safeParse({ ssn: { path: "ssn", font: "Times-Roman" } }).success).toBe(false);
    expect(LayerSchema.safeParse({ kind: "file", mimeType: "text/markdown", path: "a.md", font: "Courier" }).success).toBe(false);
  });
});
