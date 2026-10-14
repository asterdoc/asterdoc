// Generated from Paradoc's forms library. Do not edit by hand.
// Regenerate with: pnpm essentials:sync

import { describe, it, expect } from "vitest";
import { f4506T } from "./4506-t.js";

const happyPathInputs = {
  "parties": {
    "taxpayer": {
      "id": "taxpayer-0",
      "name": "Jane A Smith",
      "firstName": "Jane",
      "lastName": "Smith",
      "middleName": "A"
    },
    "spouse": {
      "id": "spouse-0",
      "name": "John B Smith",
      "firstName": "John",
      "lastName": "Smith",
      "middleName": "B"
    }
  },
  "fields": {
    "taxpayerTin": "123-45-6789",
    "spouseTin": "987-65-4321",
    "currentAddress": {
      "line1": "100 Main St",
      "locality": "Springfield",
      "region": "IL",
      "postalCode": "62704",
      "country": "US"
    },
    "transcriptType": "return_transcript",
    "taxFormNumber": "1040",
    "period1": "2024-12-31",
    "attestationAck": true
  }
} as const;

describe("4506-t", () => {
  it("loads via p.form()", () => {
    expect(f4506T.isValid()).toBe(true);
  });

  it("accepts the bundled passing vector (llm.joint-return-happy-path)", () => {
    const result = f4506T.safeFill(happyPathInputs as any);
    expect(result.success).toBe(true);
  });

  it("renders the markdown layer on the bound resolver", async () => {
    const result = f4506T.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "markdown" });
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("renders the PDF layer through the default renderer", async () => {
    const result = f4506T.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "pdf" });
    expect(output).toBeInstanceOf(Uint8Array);
    if (!(output instanceof Uint8Array)) throw new Error("PDF renderer should return bytes");
    expect(new TextDecoder().decode(output.slice(0, 4))).toBe("%PDF");
  });
});
