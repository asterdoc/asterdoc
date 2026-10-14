// Generated from Paradoc's forms library. Do not edit by hand.
// Regenerate with: pnpm essentials:sync

import { describe, it, expect } from "vitest";
import { f1099MISC } from "./1099-misc.js";

const happyPathInputs = {
  "parties": {
    "payer": {
      "id": "payer-0",
      "name": "Acme Consulting LLC",
      "legalName": "Acme Consulting LLC"
    },
    "recipient": {
      "id": "recipient-0",
      "name": "Jane R. Smith",
      "firstName": "Jane",
      "lastName": "Smith",
      "middleName": "R."
    }
  },
  "fields": {
    "void": false,
    "corrected": false,
    "calendarYear": "2024",
    "payerAddress": {
      "line1": "100 Industrial Way",
      "line2": "Suite 200",
      "locality": "Springfield",
      "region": "IL",
      "postalCode": "62704",
      "country": "US"
    },
    "payerPhone": {
      "number": "+12175550142"
    },
    "payerTin": "12-3456789",
    "recipientTin": "987-65-4321",
    "recipientAddress": {
      "line1": "42 Elm Street",
      "locality": "Champaign",
      "region": "IL",
      "postalCode": "61820",
      "country": "US"
    },
    "accountNumber": "ACCT-2024-0042",
    "secondTinNotice": false,
    "rents": {
      "amount": 12000,
      "currency": "USD"
    },
    "fatcaFilingRequirement": false,
    "directSales5kOrMore": false,
    "state1TaxWithheld": {
      "amount": 250,
      "currency": "USD"
    },
    "state1PayerStateNo": "IL / 12-3456789",
    "state1Income": {
      "amount": 12000,
      "currency": "USD"
    }
  }
} as const;

describe("1099-misc", () => {
  it("loads via p.form()", () => {
    expect(f1099MISC.isValid()).toBe(true);
  });

  it("accepts the bundled passing vector (llm.happy-path-individual-recipient)", () => {
    const result = f1099MISC.safeFill(happyPathInputs as any);
    expect(result.success).toBe(true);
  });

  it("renders the markdown layer on the bound resolver", async () => {
    const result = f1099MISC.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "markdown" });
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("renders the PDF layer through the default renderer", async () => {
    const result = f1099MISC.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "pdfCopyA" });
    expect(output).toBeInstanceOf(Uint8Array);
    if (!(output instanceof Uint8Array)) throw new Error("PDF renderer should return bytes");
    expect(new TextDecoder().decode(output.slice(0, 4))).toBe("%PDF");
  });
});
