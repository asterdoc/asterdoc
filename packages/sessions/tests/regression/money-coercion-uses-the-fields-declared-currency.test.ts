// sessions-005: money coercion assumes USD and ignores the field's declared currency.
// Input: fee { type: money, currency: "EUR" }, value 25 / "25".
// Expected: { amount: 25, currency: "EUR" } accepted. Actual: wrapped as USD, rejected for currency mismatch.
import { expect, it } from "vitest";
import { createAsterdocRuntime } from "../../src/engine/asterdoc-runtime";

const rt = () => createAsterdocRuntime(artifact({ fields: { fee: { type: "money", currency: "EUR" }, open: { type: "money" } } }));

it("plain amount on a EUR field uses EUR", () => {
  expect(rt().validateField("fee", 25)).toEqual({ ok: true, value: { amount: 25, currency: "EUR" } });
  expect(rt().validateField("fee", "25")).toEqual({ ok: true, value: { amount: 25, currency: "EUR" } });
});
it("plain amount on a field with no currency is not stored as USD", () => {
  const r = rt().validateField("open", "25");
  expect(r.ok && (r.value as { currency?: string }).currency === "USD").toBe(false);
});

export function artifact(extra: Record<string, unknown>) {
  return {
    $schema: "https://schema.asterdoc.com/2026-10-28.json", kind: "form", name: "v", version: "1.0.0", title: "V",
    parties: {}, fields: {},
    layers: { composition: { kind: "file", mimeType: "text/plain", path: "v.txt" } }, defaultLayer: "composition",
    ...extra,
  };
}