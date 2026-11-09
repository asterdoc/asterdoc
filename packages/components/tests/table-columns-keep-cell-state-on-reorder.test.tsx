// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { purchaseOrderData, purchaseOrderForm } from "../src/examples";
import { Document, Table } from "../src";
import type { TableColumn } from "../src";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Remembered({ field }: { field: string }) {
  const [first] = useState(field);
  return <i data-first={first} />;
}

const column = (field: string): TableColumn => ({ field, render: () => <Remembered field={field} /> });

const view = (columns: readonly TableColumn[]) => (
  <Document artifact={purchaseOrderForm} data={purchaseOrderData}>
    <Table path="lineItems" id="line-items" columns={columns} />
  </Document>
);

function firstRowState(): Record<string, string | null> {
  const cells = [...host.querySelectorAll('[data-field-path^="fields.lineItems.0."], [data-field-path^="lineItems.0."]')];
  return Object.fromEntries(cells.map((cell) => [cell.getAttribute("data-field-path")?.split(".").at(-1) ?? "", cell.querySelector("i")?.getAttribute("data-first") ?? null]));
}

it("keeps each cell's renderer state with its own column when columns are reordered", async () => {
  await act(async () => root.render(view([column("description"), column("amount")])));
  expect(firstRowState()).toEqual({ description: "description", amount: "amount" });
  await act(async () => root.render(view([column("amount"), column("description")])));
  expect(firstRowState()).toEqual({ description: "description", amount: "amount" });
});

it("keeps repeated columns of one field apart by their order among that field's columns", async () => {
  await act(async () => root.render(view([column("amount"), column("description"), column("amount")])));
  expect(host.querySelectorAll('[data-field-path$=".amount"] i[data-first="amount"]')).toHaveLength(
    2 * (purchaseOrderData.fields.lineItems as unknown[]).length,
  );
});
