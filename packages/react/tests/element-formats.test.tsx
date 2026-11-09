// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createFormatter } from "@asterdoc/format";
import { phoneProvider } from "@asterdoc/format/phone";
import { regionsProvider } from "@asterdoc/format/regions";
import type { Form, LayerFormat } from "@asterdoc/types";

import {
  ArtifactProvider,
  CheckModeProvider,
  ElementFormatError,
  FormatterProvider,
  createValueFormatter,
  formatByType,
  useAnnex,
  useField,
  useFormatter,
  useList,
  usePartyContact,
  useTotals,
  type DocumentData,
  type FieldBinding,
  type FormatOptions,
} from "../src";

const artifact = {
  name: "element-formats",
  fields: {
    dob: { type: "date", label: "Date of birth" },
    fee: { type: "money", label: "Fee" },
    note: { type: "text", label: "Note" },
    signedOn: { type: "date", label: "Signed on" },
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
    total: { type: "money", label: "Total", value: "fee" },
    count: { type: "integer", label: "Count", value: "1" },
  },
  annexes: { photo: { title: "Photo" } },
  parties: { client: { label: "Client", partyType: "person" } },
} as unknown as Form;

const data: DocumentData = {
  fields: {
    dob: "2021-06-15",
    fee: { amount: 12.5, currency: "EUR" },
    note: "Plain",
    signedOn: "2024-01-02",
    items: [{ when: "2022-03-04", cost: { amount: 3, currency: "EUR" }, note: "First" }],
  },
  parties: { client: { name: "Ada Lovelace" } },
  defs: { total: { amount: 12.5, currency: "EUR" }, count: 1 },
};

const empty: DocumentData = { fields: {}, parties: {}, defs: {} };

function Text({ path, format }: { path: string; format?: LayerFormat }) {
  return <i>{useField(path, format).text}</i>;
}

function markup(node: ReactNode, options: { presentation?: LayerFormat; format?: FormatOptions; data?: DocumentData } = {}) {
  const provider = <ArtifactProvider artifact={artifact} data={options.data ?? data} format={options.format}>{node}</ArtifactProvider>;
  return renderToStaticMarkup(
    options.presentation === undefined ? provider : <FormatterProvider presentation={options.presentation}>{provider}</FormatterProvider>
  );
}

function check(node: ReactNode, options: { presentation?: LayerFormat; data?: DocumentData } = {}) {
  const reported: string[] = [];
  const html = renderToStaticMarkup(
    <CheckModeProvider collector={{ report: (path) => { if (!reported.includes(path)) reported.push(path); } }}>
      <FormatterProvider presentation={options.presentation}>
        <ArtifactProvider artifact={artifact} data={options.data ?? empty} format={{ partial: true }}>{node}</ArtifactProvider>
      </FormatterProvider>
    </CheckModeProvider>
  );
  return { html, reported };
}

describe("no format anywhere", () => {
  it("prints every value as the formatter alone does", () => {
    const plain = createValueFormatter();
    const html = markup(<><Text path="dob" /><Text path="fee" /><TotalText name="total" /></>);
    expect(html).toBe(
      `<i>${plain.format(artifact.fields!.dob, data.fields.dob, "dob")}</i>` +
      `<i>${plain.format(artifact.fields!.fee, data.fields.fee, "fee")}</i>` +
      `<b>${formatByType("money", data.defs!.total, undefined, undefined, "defs.total")}</b>`
    );
    expect(html).not.toContain("06/15/2021");
  });
});

function TotalText({ name, format, block }: { name: string; format?: LayerFormat; block?: LayerFormat }) {
  return <b>{useTotals([name], { format: block, rows: [format] })[0]!.text}</b>;
}

describe("format levels", () => {
  it("prints a field in the layer format the document inherits", () => {
    expect(markup(<Text path="dob" />, { presentation: { date: { pattern: "MM/DD/YYYY" } } })).toBe("<i>06/15/2021</i>");
  });

  it("merges the document presentation over the layer per kind and property", () => {
    const html = markup(<><Text path="dob" /><Text path="fee" /></>, {
      presentation: { locale: "de-DE", date: { pattern: "MM/DD/YYYY" } },
      format: { presentation: { date: { pattern: "YYYY-MM-DD" }, money: { currencyDisplay: "none" } } },
    });
    expect(html).toBe("<i>2021-06-15</i><i>12,50</i>");
  });

  it("merges an element format over the document, leaving other elements on the document's", () => {
    const html = markup(<><Text path="dob" format={{ date: { pattern: "DD/MM/YYYY" } }} /><Text path="signedOn" /></>, {
      presentation: { date: { pattern: "YYYY-MM-DD" } },
      format: { presentation: { date: { pattern: "MM/DD/YYYY" } } },
    });
    expect(html).toBe("<i>15/06/2021</i><i>01/02/2024</i>");
  });

  it("keeps the inherited locale under an element's money format", () => {
    expect(markup(<Text path="fee" format={{ money: { currencyDisplay: "none" } }} />, { presentation: { locale: "de-DE" } }))
      .toBe("<i>12,50</i>");
  });

  it("formats list cells by list format, then column or call format", () => {
    function Cells() {
      const list = useList("items", { format: { date: { pattern: "YYYY-MM-DD" } }, columns: [{ path: "cost", format: { money: { currencyDisplay: "none" } } }] });
      return <>
        <i>{list.text(0, "when")}</i>
        <i>{list.cell(0, 0)}</i>
        <i>{list.text(0, "cost")}</i>
        <i>{list.text(0, "when", { date: { pattern: "DD/MM/YYYY" } })}</i>
      </>;
    }
    expect(markup(<Cells />)).toBe("<i>2022-03-04</i><i>3.00</i><i>€3.00</i><i>04/03/2022</i>");
  });

  it("prints one field in two columns, each in its own format", () => {
    function Cells() {
      const list = useList("items", { columns: [
        { path: "when", format: { date: { pattern: "MM/DD/YYYY" } } },
        { path: "when", format: { date: { pattern: "YYYY-MM-DD" } } },
      ] });
      return <><i>{list.cell(0, 0)}</i><i>{list.cell(0, 1)}</i></>;
    }
    expect(markup(<Cells />)).toBe("<i>03/04/2022</i><i>2022-03-04</i>");
  });

  it("prints one definition in two total rows, each in its own format", () => {
    function Rows() {
      const totals = useTotals(["total", "total"], { rows: [{ money: { currencyDisplay: "none" } }, undefined] });
      return <><b>{totals[0]!.text}</b><b>{totals[1]!.text}</b></>;
    }
    expect(markup(<Rows />)).toBe(`<b>12.50</b><b>${formatByType("money", data.defs!.total)}</b>`);
  });

  it("formats a total by its block and row formats", () => {
    expect(markup(<TotalText name="total" block={{ locale: "de-DE" }} format={{ money: { currencyDisplay: "none" } }} />))
      .toBe("<b>12,50</b>");
  });

  it("formats a party's bound lines with the party format", () => {
    function Contact() {
      const binding = usePartyContact("client", 0, { contact: ["signedOn", "fee"] }, { date: { pattern: "MM/DD/YYYY" } });
      return <i>{binding.nameText}|{binding.contactText}</i>;
    }
    expect(markup(<Contact />)).toBe(`<i>Ada Lovelace|01/02/2024, ${createValueFormatter().format(artifact.fields!.fee, data.fields.fee)}</i>`);
  });

  it("gives formatByType and DocumentFormatter.format the effective format", () => {
    expect(formatByType("date", "2021-06-15", undefined, undefined, "defs.x", undefined, { date: { pattern: "MM/DD/YYYY" } })).toBe("06/15/2021");
    const formatting = createValueFormatter({ presentation: { date: { pattern: "YYYY-MM-DD" } } });
    expect(formatting.format(artifact.fields!.dob, "2021-06-15")).toBe("2021-06-15");
    expect(formatting.format(artifact.fields!.dob, "2021-06-15", "dob", { date: { pattern: "DD/MM/YYYY" } })).toBe("15/06/2021");
  });
});

describe("format changes and stability", () => {
  async function mount() {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    return { host, root, render: (node: ReactNode) => act(async () => { root.render(node); }) };
  }

  it("updates the output when only an element's format prop changes", async () => {
    const { host, root, render } = await mount();
    const page = (format: LayerFormat) => (
      <ArtifactProvider artifact={artifact} data={data}><Text path="dob" format={format} /></ArtifactProvider>
    );
    try {
      await render(page({ date: { pattern: "MM/DD/YYYY" } }));
      expect(host.textContent).toBe("06/15/2021");
      await render(page({ date: { pattern: "YYYY-MM-DD" } }));
      expect(host.textContent).toBe("2021-06-15");
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("updates the output when only the document's presentation changes", async () => {
    const { host, root, render } = await mount();
    const page = (presentation: LayerFormat) => (
      <ArtifactProvider artifact={artifact} data={data} format={{ presentation }}><Text path="dob" /></ArtifactProvider>
    );
    try {
      await render(page({ date: { pattern: "MM/DD/YYYY" } }));
      expect(host.textContent).toBe("06/15/2021");
      await render(page({ date: { pattern: "DD/MM/YYYY" } }));
      expect(host.textContent).toBe("15/06/2021");
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("keeps one binding for equal inline formats written in another key order", async () => {
    const { root, render } = await mount();
    const seen: FieldBinding[] = [];
    function Probe({ format }: { format: LayerFormat }) {
      seen.push(useField("fee", format));
      return null;
    }
    try {
      await render(<ArtifactProvider artifact={artifact} data={data}><Probe format={{ locale: "de-DE", money: { currencyDisplay: "none" } }} /></ArtifactProvider>);
      await render(<ArtifactProvider artifact={artifact} data={data}><Probe format={{ money: { currencyDisplay: "none" }, locale: "de-DE" }} /></ArtifactProvider>);
      expect(seen.length).toBeGreaterThan(1);
      expect(seen.every((binding) => binding === seen[0])).toBe(true);
    } finally { await act(async () => { root.unmount(); }); }
  });

  it("keeps the document's formatting for an equal inline presentation", async () => {
    const { root, render } = await mount();
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useFormatter());
      seen.push(useList("items").format);
      return null;
    }
    try {
      for (const presentation of [{ date: { pattern: "MM/DD/YYYY" as const }, locale: "en-US" }, { locale: "en-US", date: { pattern: "MM/DD/YYYY" as const } }]) {
        await render(<ArtifactProvider artifact={artifact} data={data} format={{ presentation }}><Probe /></ArtifactProvider>);
      }
      expect(seen.filter((_, index) => index % 2 === 1).every((format) => format === seen[1])).toBe(true);
    } finally { await act(async () => { root.unmount(); }); }
  });
});

describe("element format faults outside a check", () => {
  it("refuses a key that does not apply to the field's type, even with no value", () => {
    expect(() => markup(<Text path="dob" format={{ money: { currencyDisplay: "none" } }} />, { data: empty, format: { partial: true } }))
      .toThrow(ElementFormatError);
  });

  it("refuses a malformed format", () => {
    expect(() => markup(<Text path="dob" format={{ date: { pattern: "MM-DD" } } as unknown as LayerFormat} />))
      .toThrow(/The format at "dob" is not valid: date\.pattern/);
  });

  it("refuses what template format modifiers refuse, by the same rules", () => {
    expect(() => markup(<Text path="dob" format={{ locale: "en-a" }} />))
      .toThrow(/The format at "dob" is not valid: locale takes a BCP 47 language tag such as "en-US", not "en-a"/);
  });

  it("refuses a list format whose key applies to no item field", () => {
    function Rows() { useList("items", { format: { locale: "en-US", money: { currencyDisplay: "none" } }, columns: [{ path: "note", format: { date: { pattern: "YYYY-MM-DD" } } }] }); return null; }
    expect(() => markup(<Rows />)).toThrow(/The format at "items\.note" is not valid: date\.pattern applies to dates, not to fields\.items\[0\]\.note, a text value\./);
  });

  it("accepts a group format whose key applies to one of its values", () => {
    function Rows() { return <i>{useList("items", { format: { money: { currencyDisplay: "none" } } }).text(0, "cost")}</i>; }
    expect(markup(<Rows />)).toBe("<i>3.00</i>");
  });
});

describe("element format faults in a check", () => {
  it("collects several invalid elements with empty data and keeps walking", () => {
    function Rows() { useList("items", { columns: [{ path: "note", format: { money: { currencyDisplay: "none" } } }] }); return null; }
    function Contact() { usePartyContact("client", 0, { contact: "note" }, { money: { currencyDisplay: "none" } }); return null; }
    function Annex() { return <i>{useAnnex("annexes.photo", { date: { pattern: "YYYY-MM-DD" } }).text}</i>; }
    const { html, reported } = check(<>
      <Text path="dob" format={{ money: { currencyDisplay: "none" } }} />
      <Text path="fee" format={{ date: { pattern: "bad" } } as unknown as LayerFormat} />
      <Rows />
      <TotalText name="count" format={{ money: { currencyDisplay: "none" } }} />
      <TotalText name="total" block={{ date: { pattern: "YYYY-MM-DD" } }} />
      <Contact />
      <Annex />
      <Text path="unknown" />
      <Text path="note" />
    </>);
    expect(reported).toEqual([
      "format:dob",
      "format:fee",
      "format:items.note",
      "format:defs.count",
      "format:defs.total",
      "format:parties.client[0]",
      "party:client[0]",
      "format:annexes.photo",
      "unknown",
    ]);
    expect(html.endsWith("<i>—</i><i>—</i>")).toBe(true);
  });

  it("checks table column formats against the item with no rows", () => {
    function Rows() { return <i>{useList("items", { columns: [{ path: "when", format: { money: { currencyDisplay: "none" } } }, { path: "cost", format: { money: { currencyDisplay: "none" } } }] }).rows.length}</i>; }
    expect(check(<Rows />).reported).toEqual(["format:items.when"]);
    expect(check(<Rows />, { data: { ...empty, fields: { items: [] } } }).reported).toEqual(["format:items.when"]);
  });

  it("reports nothing for formats that apply, under a layer format", () => {
    function Rows() { useList("items", { columns: [{ path: "when", format: { date: { pattern: "YYYY-MM-DD" } } }] }); return null; }
    const { reported } = check(<>
      <Text path="dob" format={{ date: { pattern: "DD/MM/YYYY" } }} />
      <Rows />
      <TotalText name="total" format={{ money: { currencyDisplay: "none" } }} />
    </>, { presentation: { date: { pattern: "MM/DD/YYYY" }, money: { currencyDisplay: "none" } } });
    expect(reported).toEqual([]);
  });

  it("checks values with the layer format the check is given", () => {
    const stamped = { ...data, fields: { ...data.fields, dob: "2021-06-15T10:00:00Z" } };
    expect(check(<Text path="dob" />, { presentation: { date: { pattern: "MM/DD/YYYY" } }, data: stamped }).reported).toEqual(["dob"]);
    expect(check(<Text path="dob" />, { data: stamped }).reported).toEqual([]);
  });
});

describe("nested artifact providers", () => {
  function Nested({ outer, inner }: { outer: LayerFormat; inner?: LayerFormat }) {
    return (
      <ArtifactProvider artifact={artifact} data={data} format={{ presentation: outer }}>
        <ArtifactProvider artifact={artifact} data={data} format={inner === undefined ? undefined : { presentation: inner }}>
          <Text path="dob" /><Text path="fee" />
        </ArtifactProvider>
      </ArtifactProvider>
    );
  }

  it("merges the inner presentation over the outer one per property", () => {
    expect(renderToStaticMarkup(<Nested outer={{ date: { pattern: "MM/DD/YYYY" } }} inner={{ locale: "de-DE" }} />))
      .toBe("<i>06/15/2021</i><i>12,50\u00a0€</i>");
  });

  it("inherits the outer presentation when the inner provider sets none", () => {
    expect(renderToStaticMarkup(<Nested outer={{ date: { pattern: "YYYY-MM-DD" }, money: { currencyDisplay: "none" } }} />))
      .toBe("<i>2021-06-15</i><i>12.50</i>");
  });

  it("keeps the inherited formatter while passing the presentation down", () => {
    const formatter = createValueFormatter().formatter.compose({ locale: "de-DE" });
    expect(renderToStaticMarkup(
      <FormatterProvider formatter={formatter}><Nested outer={{ money: { currencyDisplay: "none" } }} /></FormatterProvider>
    )).toBe("<i>15. Juni 2021</i><i>12,50</i>");
  });

  it("updates the inner output when only the outer presentation changes", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => { root.render(<Nested outer={{ date: { pattern: "MM/DD/YYYY" } }} inner={{ locale: "de-DE" }} />); });
      expect(host.textContent).toBe("06/15/202112,50\u00a0€");
      await act(async () => { root.render(<Nested outer={{ date: { pattern: "DD/MM/YYYY" } }} inner={{ locale: "de-DE" }} />); });
      expect(host.textContent).toBe("15/06/202112,50\u00a0€");
    } finally { await act(async () => { root.unmount(); }); }
  });
});

describe("phone, choice and boolean element formats", () => {
  const typed = {
    name: "typed-formats",
    fields: {
      phone: { type: "phone", label: "Phone" },
      status: { type: "enum", label: "Status", enum: [{ value: "A", label: "Active" }, { value: "I", label: "Inactive" }] },
      agreed: { type: "boolean", label: "Agreed" },
      note: { type: "text", label: "Note" },
    },
  } as unknown as Form;
  const values: DocumentData = { fields: { phone: { number: "+12025550123" }, status: "A", agreed: true, note: "x" }, parties: {} };

  function Typed({ path, format }: { path: string; format?: LayerFormat }) {
    return <i>{useField(path, format).text}</i>;
  }
  const page = (node: ReactNode) => renderToStaticMarkup(<ArtifactProvider artifact={typed} data={values}>{node}</ArtifactProvider>);
  const withPhones = (node: ReactNode) => renderToStaticMarkup(
    <FormatterProvider formatter={createFormatter({ providers: { phone: phoneProvider } })}>
      <ArtifactProvider artifact={typed} data={values}>{node}</ArtifactProvider>
    </FormatterProvider>
  );

  it("refuses a phone style with the lean default formatter, naming the provider to add", () => {
    expect(() => page(<Typed path="phone" format={{ phone: { style: "national" } }} />)).toThrow(/@asterdoc\/format\/phone/);
    expect(page(<Typed path="phone" />)).toBe("<i>+12025550123</i>");
  });

  it("prints each in its element format", () => {
    expect(withPhones(<>
      <Typed path="phone" format={{ phone: { style: "national" } }} />
      <Typed path="status" format={{ choice: { display: "value" } }} />
      <Typed path="agreed" format={{ boolean: { trueLabel: "Yes", falseLabel: "No" } }} />
      <Typed path="status" />
    </>)).toBe("<i>(202) 555-0123</i><i>A</i><i>Yes</i><i>Active</i>");
  });

  it("refuses each on a value it does not apply to, as a template modifier is refused", () => {
    expect(() => page(<Typed path="note" format={{ phone: { style: "national" } }} />)).toThrow(/phone\.style applies to phone numbers, not to fields\.note, a text value/);
    expect(() => page(<Typed path="note" format={{ choice: { display: "value" } }} />)).toThrow(/choice\.display applies to enum and multiselect values/);
    expect(() => page(<Typed path="status" format={{ boolean: { trueLabel: "Yes" } }} />)).toThrow(/boolean\.trueLabel applies to booleans/);
  });

  it("reports each in a check without stopping", () => {
    const reported: string[] = [];
    renderToStaticMarkup(
      <CheckModeProvider collector={{ report: (path) => { reported.push(path); } }}>
        <ArtifactProvider artifact={typed} data={{ fields: {}, parties: {} }} format={{ partial: true }}>
          <Typed path="agreed" format={{ phone: { style: "e164" } }} />
          <Typed path="phone" format={{ boolean: { falseLabel: "No" } }} />
          <Typed path="note" format={{ choice: { display: "label" } }} />
          <Typed path="status" format={{ choice: { display: "value" } }} />
        </ArtifactProvider>
      </CheckModeProvider>
    );
    expect(reported).toEqual(["format:agreed", "format:phone", "format:note"]);
  });
});

describe("country and region element formats", () => {
  const places = {
    name: "places",
    fields: {
      country: { type: "country", label: "Country" },
      province: { type: "region", label: "Province", country: "CA" },
      note: { type: "text", label: "Note" },
    },
  } as unknown as Form;
  const values: DocumentData = { fields: { country: "CA", province: "CA-ON", note: "x" }, parties: {} };
  function Place({ path, format }: { path: string; format?: LayerFormat }) {
    return <i>{useField(path, format).text}</i>;
  }
  const page = (node: ReactNode) => renderToStaticMarkup(<ArtifactProvider artifact={places} data={values}>{node}</ArtifactProvider>);

  it("prints a country by name with the lean default formatter", () => {
    expect(page(<Place path="country" format={{ country: { display: "name" } }} />)).toBe("<i>Canada</i>");
  });

  it("prints a region with a formatter that has the regions provider, and names the provider without one", () => {
    expect(renderToStaticMarkup(
      <FormatterProvider formatter={createFormatter({ providers: { regions: regionsProvider } })}>
        <ArtifactProvider artifact={places} data={values}><Place path="province" format={{ region: { display: "code" } }} /></ArtifactProvider>
      </FormatterProvider>
    )).toBe("<i>ON</i>");
    expect(() => page(<Place path="province" format={{ region: { display: "code" } }} />)).toThrow(/@asterdoc\/format\/regions/);
  });

  it("refuses them on a value they do not apply to, as a template modifier is refused", () => {
    expect(() => page(<Place path="note" format={{ country: { display: "name" } }} />)).toThrow(/country\.display applies to countries and addresses/);
    expect(() => page(<Place path="country" format={{ region: { display: "name" } }} />)).toThrow(/region\.display applies to subdivisions and addresses/);
  });
});
