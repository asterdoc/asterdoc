// Generated from Asterdoc's forms library. Do not edit by hand.
// Regenerate with: pnpm essentials:sync

import { describe, it, expect } from "vitest";
import { w9 } from "./w-9.js";

const happyPathInputs = {
  "parties": {
    "taxpayer": {
      "id": "taxpayer-0",
      "name": "Jane Q. Public",
      "firstName": "Jane",
      "lastName": "Public",
      "middleName": "Q."
    }
  },
  "fields": {
    "taxClassification": "individual_or_sole_proprietor",
    "ssn": "123-45-6789",
    "mailingAddress": {
      "line1": "1 Main St",
      "locality": "Springfield",
      "region": "IL",
      "postalCode": "62704",
      "country": "US"
    }
  }
} as const;

describe("w-9", () => {
  it("loads via a.form()", () => {
    expect(w9.isValid()).toBe(true);
  });

  it("accepts the bundled passing vector (llm.tin.individual-with-ssn-only)", () => {
    const result = w9.safeFill(happyPathInputs as any);
    expect(result.success).toBe(true);
  });

  it("renders the markdown layer on the bound resolver", async () => {
    const result = w9.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "markdown" });
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("renders the PDF layer through the default renderer", async () => {
    const result = w9.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "pdf" });
    expect(output).toBeInstanceOf(Uint8Array);
    if (!(output instanceof Uint8Array)) throw new Error("PDF renderer should return bytes");
    expect(new TextDecoder().decode(output.slice(0, 4))).toBe("%PDF");
  });
});
