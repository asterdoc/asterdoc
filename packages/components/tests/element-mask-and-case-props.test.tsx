import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Form } from "@asterdoc/types";
import type { DocumentData } from "@asterdoc/react";

import { Document, Field, Table } from "../src";

const artifact = {
  $schema: "https://schema.asterdoc.com/2026-11-06.json",
  kind: "form",
  name: "mask-case-props",
  version: "1.0.0",
  title: "Mask and case props",
  fields: {
    ssn: { type: "text", label: "SSN", mask: "###-##-####" },
    note: { type: "text", label: "Note" },
    people: { type: "list", label: "People", item: { type: "fieldset", fields: { ein: { type: "text", label: "EIN", mask: "##-#######" }, name: { type: "text", label: "Name" } } } },
  },
} as unknown as Form;

const data: DocumentData = { fields: { ssn: "123456789", note: "plain", people: [{ ein: "123456789", name: "ada" }] }, parties: {} };

const page = (children: React.ReactNode) => renderToStaticMarkup(<Document artifact={artifact} data={data}>{children}</Document>);

describe("mask strings and case on component props", () => {
  it("prints a Field with a mask string and in upper case", () => {
    const html = page(<><Field path="ssn" format={{ text: { mask: "### ## ####" } }} /><Field path="note" format={{ case: "upper" }} /><Field path="ssn" label="Plain" /></>);
    expect(html).toContain("123 45 6789");
    expect(html).toContain("PLAIN");
    expect(html).toContain("123-45-6789");
  });

  it("prints Table columns with a mask string and in upper case", () => {
    const html = page(<Table path="people" columns={[{ field: "ein", format: { text: { mask: "## ### ####" } } }, { field: "name", format: { case: "upper" } }]} />);
    expect(html).toContain("12 345 6789");
    expect(html).toContain("ADA");
    expect(html).not.toContain("12-3456789");
  });
});
