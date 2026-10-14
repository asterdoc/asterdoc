// Generated from Paradoc's forms library. Do not edit by hand.
// Regenerate with: pnpm essentials:sync

import { describe, it, expect } from "vitest";
import { achBankAccountInfo } from "./ach-bank-account-info.js";

const happyPathInputs = {
  "parties": {
    "requestor": {
      "id": "requestor-0",
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
    "actionType": "new",
    "accountHolderType": "organization",
    "orgEntityType": "sole_prop",
    "bankName": "x",
    "routingNumber": "111111111",
    "accountNumber": "xxxx",
    "accountType": "checking"
  }
} as const;

describe("ach-bank-account-info", () => {
  it("loads via p.form()", () => {
    expect(achBankAccountInfo.isValid()).toBe(true);
  });

  it("accepts the bundled passing vector (synth.required.orgentitytype.present-accountholdertype-organization)", () => {
    const result = achBankAccountInfo.safeFill(happyPathInputs as any);
    expect(result.success).toBe(true);
  });

  it("renders the markdown layer on the bound resolver", async () => {
    const result = achBankAccountInfo.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "markdown" });
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("renders the PDF layer through the default renderer", async () => {
    const result = achBankAccountInfo.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "pdf" });
    expect(output).toBeInstanceOf(Uint8Array);
    if (!(output instanceof Uint8Array)) throw new Error("PDF renderer should return bytes");
    expect(new TextDecoder().decode(output.slice(0, 4))).toBe("%PDF");
  });
});
