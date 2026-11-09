import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { checkElement } from "@asterdoc/react-pdf/check";
import type { Form, LayerFormat } from "@asterdoc/types";
import type { DocumentData } from "@asterdoc/react";

import { Document, Field, Party, Table, Totals } from "../src";

const artifact = {
  $schema: "https://schema.asterdoc.com/2026-11-06.json",
  kind: "form",
  name: "element-format-props",
  version: "1.0.0",
  title: "Element format props",
  fields: {
    dob: { type: "date", label: "Date of birth" },
    phone: { type: "text", label: "Phone" },
    items: {
      type: "list",
      label: "Items",
      item: {
        type: "fieldset",
        fields: {
          when: { type: "date", label: "When" },
          cost: { type: "money", label: "Cost" },
          note: { type: "text", label: "Note" },
        },
      },
    },
  },
  defs: {
    total: { type: "money", label: "Total", value: "sum(items[*].cost)" },
    issued: { type: "date", label: "Issued", value: "today()" },
  },
  parties: { client: { label: "Client", partyType: "person" } },
} as unknown as Form;

const data: DocumentData = {
  fields: {
    dob: "2021-06-15",
    phone: "555",
    items: [{ when: "2022-03-04", cost: { amount: 3, currency: "EUR" }, note: "First" }],
  },
  parties: { client: { name: "Ada Lovelace" } },
  defs: { total: { amount: 3, currency: "EUR" }, issued: "2026-11-09" },
};

function page(children: ReactNode, presentation?: LayerFormat, rows: DocumentData = data) {
  return renderToStaticMarkup(
    <Document artifact={artifact} data={rows} format={presentation === undefined ? undefined : { presentation }}>{children}</Document>
  );
}

const COLUMNS = [{ field: "when" }, { field: "cost" }, { field: "note" }] as const;

describe("component format props", () => {
  it("prints a Field in its own format over the document's", () => {
    const html = page(<><Field path="dob" format={{ date: { pattern: "DD/MM/YYYY" } }} /><Field path="dob" label="Plain" /></>, { date: { pattern: "YYYY-MM-DD" } });
    expect(html).toContain("15/06/2021");
    expect(html).toContain("2021-06-15");
  });

  it("prints Table cells by column format over table format, and footer rows by their own", () => {
    const html = page(
      <Table
        path="items"
        format={{ date: { pattern: "YYYY-MM-DD" } }}
        columns={[{ field: "when" }, { field: "cost", format: { money: { currencyDisplay: "none" } } }, { field: "note" }]}
        footer={[{ def: "total", format: { money: { currencyDisplay: "none" } } }, { def: "issued" }]}
      />
    );
    expect(html).toContain("2022-03-04");
    expect(html).toMatch(/data-field-path="items\.0\.cost"[^>]*>3\.00</);
    expect(html).toMatch(/data-def="total".*>3\.00</);
    expect(html).not.toContain("2026-11-09");
  });

  it("prints Totals rows by row format over the block format", () => {
    const html = page(
      <Totals
        format={{ date: { pattern: "MM/DD/YYYY" } }}
        rows={[{ def: "total", format: { money: { currencyDisplay: "none" } } }, { def: "issued" }]}
      />
    );
    expect(html).toContain(">3.00<");
    expect(html).toContain("11/09/2026");
  });

  it("prints a Party's lines in the party format", () => {
    const html = page(<Party role="client" contact="dob" format={{ date: { pattern: "MM/DD/YYYY" } }} />);
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("06/15/2021");
  });

  it("prints the same markup with no format props as before", () => {
    const plain = page(<><Field path="dob" /><Table path="items" columns={COLUMNS} footer={[{ def: "total" }]} /><Totals rows={[{ def: "issued" }]} /><Party role="client" /></>);
    expect(plain).toContain("Jun 15, 2021");
    expect(plain).toContain("€3.00");
    expect(plain).not.toContain("2026-11-09");
  });
});

describe("repeated columns and rows", () => {
  it("prints one field in two Table columns, each in its own format", () => {
    const html = page(<Table path="items" columns={[
      { field: "when", format: { date: { pattern: "MM/DD/YYYY" } } },
      { field: "when", format: { date: { pattern: "YYYY-MM-DD" } } },
    ]} />);
    expect(html).toContain(">03/04/2022<");
    expect(html).toContain(">2022-03-04<");
  });

  it("prints one definition in two footer and Totals rows, each in its own format", () => {
    const footer = page(<Table path="items" columns={COLUMNS} footer={[{ def: "total", format: { money: { currencyDisplay: "none" } } }, { def: "total" }]} />);
    expect(footer).toMatch(/data-def="total".*>3\.00<.*data-def="total".*>€3\.00</s);
    const totals = page(<Totals rows={[{ def: "total" }, { def: "total", format: { money: { currencyDisplay: "none" } } }]} />);
    expect(totals).toMatch(/data-def="total".*>€3\.00<.*data-def="total".*>3\.00</s);
  });

  it("checks an invalid format on a repeated column, row or footer row that a later one would hide", async () => {
    const element = (
      <Document artifact={artifact} data={{ fields: { items: [] }, parties: {}, defs: {} }}>
        <Table
          path="items"
          columns={[{ field: "note", format: { money: { currencyDisplay: "none" } } }, { field: "note" }]}
          footer={[{ def: "issued", format: { money: { currencyDisplay: "none" } } }, { def: "issued" }]}
        />
        <Totals rows={[{ def: "total", format: { date: { pattern: "YYYY-MM-DD" } } }, { def: "total", format: { money: { currencyDisplay: "none" } } }]} />
      </Document>
    );
    const result = await checkElement(element);
    expect([...result.unresolvedPaths].sort()).toEqual(["format:defs.issued", "format:defs.total", "format:items.note"]);
  }, 60_000);
});

describe("composition check of component formats", () => {
  it("collects every invalid element format with empty lists and data", async () => {
    const element = (
      <Document artifact={artifact} data={{ fields: { items: [] }, parties: {}, defs: {} }}>
        <Field path="dob" format={{ money: { currencyDisplay: "none" } }} />
        <Table
          path="items"
          columns={[{ field: "note", format: { date: { pattern: "YYYY-MM-DD" } } }, { field: "cost" }]}
          footer={[{ def: "issued", format: { money: { currencyDisplay: "none" } } }]}
        />
        <Totals rows={[{ def: "total" }]} format={{ date: { pattern: "YYYY-MM-DD" } }} />
        <Party role="client" contact="phone" format={{ money: { currencyDisplay: "none" } }} />
        <Field path="phone" format={{ text: true } as unknown as LayerFormat} />
        <Field path="missing" />
      </Document>
    );
    const result = await checkElement(element);
    expect([...result.unresolvedPaths].sort()).toEqual([
      "format:defs.issued",
      "format:defs.total",
      "format:dob",
      "format:items.note",
      "format:parties.client[0]",
      "format:phone",
      "missing",
      "party:client[0]",
    ]);
  }, 60_000);

  it("passes formats that apply, with the layer format beneath them", async () => {
    const element = (
      <Document artifact={artifact} data={data}>
        <Field path="dob" format={{ date: { pattern: "DD/MM/YYYY" } }} />
        <Table path="items" columns={[{ field: "cost", format: { money: { currencyDisplay: "none" } } }]} format={{ locale: "de-DE" }} />
        <Party role="client" contact="dob" format={{ date: { pattern: "MM/DD/YYYY" } }} />
      </Document>
    );
    const result = await checkElement(element, { presentation: { date: { pattern: "MM/DD/YYYY" } } });
    expect(result.unresolvedPaths).toEqual([]);
  }, 60_000);
});
