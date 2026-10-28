// Generated from Asterdoc's forms library. Do not edit by hand.
// Regenerate with: pnpm essentials:sync

import { describe, it, expect } from "vitest";
import { achChangeForm } from "./ach-change-form.js";

const happyPathInputs = {
  "parties": {
    "originator": {
      "id": "originator-0",
      "name": "Test Party",
      "entityType": "llc"
    },
    "accountHolder": {
      "id": "accountHolder-0",
      "name": "Test Party",
      "legalName": "Test Party"
    }
  },
  "fields": {
    "accountHolderType": "organization",
    "accountHolderAddress": {
      "line1": "100 Test St",
      "locality": "TestCity",
      "region": "TS",
      "postalCode": "00000",
      "country": "US"
    },
    "accountHolderPhone": {
      "number": "+15555550100"
    },
    "accountHolderEmail": "test@example.com",
    "oldAccountLast4": "1111",
    "changeType": "update_account_info",
    "changeOtherDescription": "x",
    "newBankName": "x",
    "newRoutingNumber": "111111111",
    "newAccountNumber": "xxxx",
    "newAccountType": "checking",
    "newAmount": {
      "amount": 0.01,
      "currency": "USD"
    },
    "newFrequency": "weekly",
    "effectiveDate": "2024-01-01"
  }
} as const;

describe("ach-change-form", () => {
  it("loads via p.form()", () => {
    expect(achChangeForm.isValid()).toBe(true);
  });

  it("accepts the bundled passing vector (synth.required.accountholderphone.present-accountholdertype-organization)", () => {
    const result = achChangeForm.safeFill(happyPathInputs as any);
    expect(result.success).toBe(true);
  });

  it("renders the markdown layer on the bound resolver", async () => {
    const result = achChangeForm.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "markdown" });
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("renders the PDF layer through the default renderer", async () => {
    const result = achChangeForm.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "pdf" });
    expect(output).toBeInstanceOf(Uint8Array);
    if (!(output instanceof Uint8Array)) throw new Error("PDF renderer should return bytes");
    expect(new TextDecoder().decode(output.slice(0, 4))).toBe("%PDF");
  });
});
