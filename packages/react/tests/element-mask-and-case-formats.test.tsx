import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Form, LayerFormat, ValueFormat } from "@asterdoc/types";

import { ArtifactProvider, CheckModeProvider, ElementFormatError, useField, useList, type DocumentData } from "../src";

const artifact = {
  name: "element-mask-case",
  fields: {
    ssn: { type: "text", label: "SSN", mask: "###-##-####" },
    note: { type: "text", label: "Note" },
    email: { type: "email", label: "Email" },
    dob: { type: "date", label: "Date of birth" },
    people: { type: "list", label: "People", item: { type: "fieldset", fields: { ein: { type: "text", label: "EIN", mask: "##-#######" } } } },
  },
} as unknown as Form;

const data: DocumentData = {
  fields: { ssn: "123456789", note: "istanbul", email: "ada@example.com", dob: "2021-06-15", people: [{ ein: "123456789" }] },
  parties: {},
};

function Text({ path, format }: { path: string; format?: ValueFormat }) {
  return <i>{useField(path, format).text}</i>;
}

function Eins({ format }: { format?: ValueFormat }) {
  const list = useList("people", { columns: [{ path: "ein", ...(format && { format }) }] });
  return <b>{list.cell(0, 0)}</b>;
}

function markup(node: ReactNode, presentation?: LayerFormat) {
  return renderToStaticMarkup(<ArtifactProvider artifact={artifact} data={data} format={presentation ? { presentation } : undefined}>{node}</ArtifactProvider>);
}

describe("an element text.mask", () => {
  it("prints a masked field with the field's mask, without it, or with a mask string", () => {
    expect(markup(<><Text path="ssn" /><Text path="ssn" format={{ text: { mask: false } }} /><Text path="ssn" format={{ text: { mask: "### ## ####" } }} /></>))
      .toBe("<i>123-45-6789</i><i>123456789</i><i>123 45 6789</i>");
    expect(markup(<Text path="note" format={{ text: { mask: "@@@@-@@@@" } }} />)).toBe("<i>ista-nbul</i>");
  });

  it("applies a mask string on a table column, over the document's text.mask", () => {
    expect(markup(<Eins />)).toBe("<b>12-3456789</b>");
    expect(markup(<Eins format={{ text: { mask: "## ### ####" } }} />, { text: { mask: false } })).toBe("<b>12 345 6789</b>");
    expect(markup(<Eins />, { text: { mask: false } })).toBe("<b>123456789</b>");
  });

  it("refuses a mask string on a value that is not a text field, and reports it in check mode", () => {
    expect(() => markup(<Text path="dob" format={{ text: { mask: "####" } }} />)).toThrow(ElementFormatError);
    const reported: string[] = [];
    renderToStaticMarkup(
      <CheckModeProvider collector={{ report: (path) => { reported.push(path); } }}>
        <ArtifactProvider artifact={artifact} data={{ fields: {}, parties: {} }} format={{ partial: true }}>
          <Text path="dob" format={{ text: { mask: "####" } }} />
          <Text path="ssn" format={{ text: { mask: "A-B" } }} />
        </ArtifactProvider>
      </CheckModeProvider>
    );
    expect(reported).toEqual(["format:dob", "format:ssn"]);
  });
});

describe("an element case", () => {
  it("upper-cases an element's value, and a document's upper skips email", () => {
    expect(markup(<><Text path="note" format={{ case: "upper" }} /><Text path="note" /></>)).toBe("<i>ISTANBUL</i><i>istanbul</i>");
    expect(markup(<><Text path="note" /><Text path="email" /><Text path="ssn" /></>, { case: "upper" })).toBe("<i>ISTANBUL</i><i>ada@example.com</i><i>123-45-6789</i>");
  });

  it("follows the locale, and an element's none turns the document's upper off", () => {
    expect(markup(<Text path="note" format={{ case: "upper", locale: "tr-TR" }} />)).toBe("<i>İSTANBUL</i>");
    expect(markup(<Text path="note" format={{ case: "none" }} />, { case: "upper" })).toBe("<i>istanbul</i>");
  });

  it("refuses a case it does not know", () => {
    expect(() => markup(<Text path="note" format={{ case: "lower" } as unknown as ValueFormat} />)).toThrow(ElementFormatError);
  });
});
