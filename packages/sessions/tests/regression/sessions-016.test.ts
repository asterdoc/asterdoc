// sessions-016: three field walkers disagree on list item paths.
// Input: list field `items` whose item has fields { name }.
// Expected: hasField("items[0].name") and listFields() agree (listFields publishes "items[].name").
// Actual: hasField is true, listFields() has only "items" (treated as a leaf), so fieldIndex has no entry.
import { expect, it } from "vitest";
import { createAsterdocRuntime } from "../../src/engine/asterdoc-runtime";

it("sessions-016: listFields matches hasField for list item fields", () => {
  const rt = createAsterdocRuntime(artifact({ fields: { items: { type: "list", item: { type: "fieldset", fields: { name: { type: "text" } } } } } }));
  expect(rt.hasField("items[0].name")).toBe(true);
  expect(rt.listFields().map((f) => f.fieldPath)).toContain("items[].name");
});

export function artifact(extra: Record<string, unknown>) {
  return {
    $schema: "https://schema.asterdoc.com/2026-10-28.json", kind: "form", name: "v", version: "1.0.0", title: "V",
    parties: {}, fields: {},
    layers: { composition: { kind: "file", mimeType: "text/plain", path: "v.txt" } }, defaultLayer: "composition",
    ...extra,
  };
}