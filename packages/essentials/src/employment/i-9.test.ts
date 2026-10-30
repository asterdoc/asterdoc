// Generated from Asterdoc's forms library. Do not edit by hand.
// Regenerate with: pnpm essentials:sync

import { describe, it, expect } from "vitest";
import { i9 } from "./i-9.js";

const happyPathInputs = {
  "parties": {
    "employee": {
      "id": "employee-0",
      "firstName": "Jordan",
      "middleName": "M",
      "lastName": "Rivera",
      "name": "Jordan Rivera"
    },
    "employer": {
      "id": "employer-0",
      "name": "Acme Manufacturing LLC",
      "legalName": "Acme Manufacturing LLC",
      "entityType": "llc"
    },
    "preparer": []
  },
  "fields": {
    "employeeAddress": {
      "line1": "123 Main St",
      "locality": "Springfield",
      "region": "IL",
      "postalCode": "62704",
      "country": "US"
    },
    "employeeDateOfBirth": "1990-06-15",
    "citizenshipStatus": "us_citizen",
    "documentRoute": "list_a",
    "listADocument1Title": "U.S. Passport",
    "listADocument1IssuingAuthority": "U.S. Department of State",
    "firstDayOfEmployment": "2026-04-15",
    "employerRepresentativeName": "Patricia Chen, HR Director",
    "employerBusinessAddress": {
      "line1": "500 Industrial Way",
      "locality": "Springfield",
      "region": "IL",
      "postalCode": "62701",
      "country": "US"
    },
    "alternativeProcedureUsed": false,
    "employerEverifyEnrolled": false,
    "preparerAssistanceUsed": false
  }
} as const;

describe("i-9", () => {
  it("loads via a.form()", () => {
    expect(i9.isValid()).toBe(true);
  });

  it("accepts the bundled passing vector (llm.list_a.minimal-pass)", () => {
    const result = i9.safeFill(happyPathInputs as any);
    expect(result.success).toBe(true);
  });

  it("renders the markdown layer on the bound resolver", async () => {
    const result = i9.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "markdown" });
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("renders the PDF layer through the default renderer", async () => {
    const result = i9.safeFill(happyPathInputs as any);
    if (!result.success) throw new Error("passing vector should be accepted");
    const output = await result.data.render({ layer: "pdf" });
    expect(output).toBeInstanceOf(Uint8Array);
    if (!(output instanceof Uint8Array)) throw new Error("PDF renderer should return bytes");
    expect(new TextDecoder().decode(output.slice(0, 4))).toBe("%PDF");
  });
});
