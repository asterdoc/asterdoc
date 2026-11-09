import { pageTextRuns } from "@asterdoc/render/pdf";
import { describe, expect, it } from "vitest";
import type { Form, LayerFormat } from "@asterdoc/types";

import { Document } from "../../components/src/components/document";
import { Field } from "../../components/src/components/field";
import { checkComposition } from "../src/check";
import { reactRenderer, type ReactLayerComponentProps } from "../src/layer";
import { renderPdf } from "../src/render";

const artifact = {
  $schema: "https://schema.asterdoc.com/2026-11-06.json",
  kind: "form",
  name: "react-layer-format",
  version: "1.0.0",
  title: "React layer format",
  fields: {
    dob: { type: "date", label: "Date of birth" },
    fee: { type: "money", label: "Fee" },
  },
} as unknown as Form;

const data = { fields: { dob: "2021-06-15", fee: { amount: 12.5, currency: "EUR" } }, parties: {} };

function Composition(props: ReactLayerComponentProps) {
  return (
    <Document artifact={props.artifact} data={props.data}>
      <Field path="dob" />
      <Field path="fee" label="Fee" />
    </Document>
  );
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  return (await pageTextRuns(bytes)).flatMap((page) => page.runs.map((run) => run.text)).join(" ");
}

function renderLayer(format: LayerFormat | undefined, presentation?: LayerFormat) {
  const renderer = reactRenderer({ components: { "doc.tsx": Composition }, pdf: presentation ? { presentation } : undefined });
  return renderer.render({
    kind: "form",
    artifact,
    template: { kind: "file", mimeType: "text/tsx", path: "doc.tsx", ...(format && { format }) },
    data,
  } as never);
}

describe("a React layer's format", () => {
  it("prints the composition's values in the layer format", async () => {
    const text = await pdfText(await renderLayer({ date: { pattern: "MM/DD/YYYY" }, money: { currencyDisplay: "none" } }));
    expect(text).toContain("06/15/2021");
    expect(text).toContain("12.50");
    expect(text).not.toContain("€");
  }, 60_000);

  it("merges the layer format over the caller's presentation per property", async () => {
    const text = await pdfText(await renderLayer({ date: { pattern: "YYYY-MM-DD" } }, { date: { pattern: "MM/DD/YYYY" }, money: { currencyDisplay: "none" } }));
    expect(text).toContain("2021-06-15");
    expect(text).not.toContain("€");
  }, 60_000);

  it("prints as before when the layer sets no format", async () => {
    const text = await pdfText(await renderLayer(undefined));
    expect(text).toContain("Jun 15, 2021");
    expect(text).toContain("€12.50");
  }, 60_000);

  it("prints a renderPdf presentation under the document's own", async () => {
    const element = (
      <Document artifact={artifact} data={data} format={{ presentation: { money: { currencyDisplay: "none" } } }}>
        <Field path="dob" />
        <Field path="fee" />
      </Document>
    );
    const text = await pdfText((await renderPdf(element, { presentation: { date: { pattern: "DD/MM/YYYY" } } })).bytes);
    expect(text).toContain("15/06/2021");
    expect(text).not.toContain("€");
  }, 60_000);
});

describe("checking a composition with its layer format", () => {
  const stamped = { fields: { dob: "2021-06-15T10:00:00Z" }, parties: {} };

  it("checks values in the layer format it is given", async () => {
    const withFormat = await checkComposition({ artifact, composition: Composition, data: stamped, presentation: { date: { pattern: "MM/DD/YYYY" } } });
    expect(withFormat.unresolvedPaths).toEqual(["dob"]);
    const without = await checkComposition({ artifact, composition: Composition, data: stamped });
    expect(without.unresolvedPaths).toEqual([]);
  }, 60_000);

  it("reports an element format that does not apply", async () => {
    function Wrong(props: ReactLayerComponentProps) {
      return (
        <Document artifact={props.artifact} data={props.data}>
          <Field path="fee" format={{ date: { pattern: "MM/DD/YYYY" } }} />
          <Field path="dob" />
        </Document>
      );
    }
    const result = await checkComposition({ artifact, composition: Wrong, presentation: { money: { currencyDisplay: "none" } } });
    expect(result.unresolvedPaths).toEqual(["format:fee"]);
  }, 60_000);
});

describe("phone styles on the server", () => {
  const phoned = {
    ...artifact,
    name: "react-layer-phone",
    fields: { phone: { type: "phone", label: "Phone" } },
  } as unknown as Form;
  const phoneData = { fields: { phone: { number: "+12025550123" } }, parties: {} };

  function Phone(props: ReactLayerComponentProps) {
    return (
      <Document artifact={props.artifact} data={props.data}>
        <Field path="phone" format={{ phone: { style: "national" } }} />
      </Document>
    );
  }

  it("prints a phone style through renderPdf with no formatter given", async () => {
    const text = await pdfText((await renderPdf(<Phone artifact={phoned} data={phoneData} />)).bytes);
    expect(text).toContain("(202) 555-0123");
  }, 60_000);

  it("prints a layer's phone style through reactRenderer with no formatter given", async () => {
    function Plain(props: ReactLayerComponentProps) {
      return <Document artifact={props.artifact} data={props.data}><Field path="phone" /></Document>;
    }
    const bytes = await reactRenderer({ components: { "phone.tsx": Plain } }).render({
      kind: "form",
      artifact: phoned,
      template: { kind: "file", mimeType: "text/tsx", path: "phone.tsx", format: { phone: { style: "national" } } },
      data: phoneData,
    } as never);
    expect(await pdfText(bytes)).toContain("(202) 555-0123");
  }, 60_000);

  it("checks a phone style with the full formatter", async () => {
    const result = await checkComposition({ artifact: phoned, composition: Phone, data: phoneData });
    expect(result.unresolvedPaths).toEqual([]);
  }, 60_000);
});

describe("region names on the server", () => {
  it("prints a region by name through renderPdf with no formatter given", async () => {
    const places = { ...artifact, name: "react-layer-region", fields: { province: { type: "region", label: "Province", country: "CA" } } } as unknown as Form;
    const element = (
      <Document artifact={places} data={{ fields: { province: "CA-ON" }, parties: {} }}>
        <Field path="province" format={{ region: { display: "name" } }} />
      </Document>
    );
    expect(await pdfText((await renderPdf(element)).bytes)).toContain("Ontario");
  }, 60_000);
});
