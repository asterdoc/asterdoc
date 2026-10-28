// Generated from Asterdoc's forms library. Do not edit by hand.
// Regenerate with: pnpm essentials:sync

import { describe, it, expect } from "vitest";
import { achDirectDeposit } from "./ach-direct-deposit.js";

const happyPathInputs = {
  "parties": {
    "employer": {
      "id": "employer-0",
      "legalName": "Acme Corp",
      "name": "Acme"
    },
    "employee": {
      "id": "employee-0",
      "name": "Jane Doe",
      "firstName": "Jane",
      "lastName": "Doe"
    }
  },
  "fields": {
    "employeeAddress": {
      "line1": "5 Main St",
      "locality": "Boston",
      "region": "MA",
      "postalCode": "02101",
      "country": "US"
    },
    "actionType": "new",
    "account1BankName": "First Bank",
    "account1RoutingNumber": "111000025",
    "account1AccountNumber": "1234567890",
    "account1AccountType": "checking",
    "account1AllotmentType": "net_remainder",
    "account1VoidedCheckAttached": true
  }
} as const;

describe("ach-direct-deposit", () => {
  it("loads via p.form()", () => {
    expect(achDirectDeposit.isValid()).toBe(true);
  });

  it("accepts the bundled passing vector (llm.scenario.new-single-account-net)", () => {
    const result = achDirectDeposit.safeFill(happyPathInputs as any);
    expect(result.success).toBe(true);
  });

  it("renders the markdown layer on the bound resolver", async () => {
    const result = achDirectDeposit.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "markdown" });
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("renders the PDF layer through the default renderer", async () => {
    const result = achDirectDeposit.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "pdf" });
    expect(output).toBeInstanceOf(Uint8Array);
    if (!(output instanceof Uint8Array)) throw new Error("PDF renderer should return bytes");
    expect(new TextDecoder().decode(output.slice(0, 4))).toBe("%PDF");
  });
});
