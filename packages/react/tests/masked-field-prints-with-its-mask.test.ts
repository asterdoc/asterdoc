import { describe, expect, it } from "vitest";
import type { FormField } from "@asterdoc/types";
import { ArtifactFieldFormatError, createValueFormatter } from "../src/lib/format";

const ssn = { type: "text", mask: "###-##-####" } as FormField;

describe("a masked text field in a React layer", () => {
  it("prints the stored value with its mask", () => {
    expect(createValueFormatter().format(ssn, "123456789", "fields.ssn")).toBe("123-45-6789");
    expect(createValueFormatter().format({ type: "text" } as FormField, "123456789", "fields.note")).toBe("123456789");
  });

  it("refuses a stored value that does not fit, and shows a placeholder for a prefix while filling", () => {
    expect(() => createValueFormatter().format(ssn, "12345", "fields.ssn")).toThrow(ArtifactFieldFormatError);
    expect(createValueFormatter({ partial: true }).format(ssn, "12345", "fields.ssn")).toBe("—");
  });
});
