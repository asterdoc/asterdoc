import { describe, expect, it } from "vitest";
import type { Actor } from "../src/event-log/types";
import { createAsterdocRuntime } from "../src/engine/asterdoc-runtime";
import { execute } from "../src/engine/execute";
import type { FormSession } from "../src/engine/types";

const USER: Actor = { kind: "user" };

const artifact = {
	$schema: "https://schema.asterdoc.com/2026-11-06.json",
	kind: "form",
	name: "places",
	version: "1.0.0",
	title: "Places",
	parties: {},
	fields: {
		birthCountry: { type: "country" },
		state: { type: "region", country: "US" },
		home: { type: "address", codes: true },
		postal: { type: "address" },
		price: { type: "money" },
		previous: { type: "list", item: { type: "fieldset", fields: { country: { type: "country" } } } },
	},
	layers: { composition: { kind: "file", mimeType: "text/plain", path: "p.txt" } },
	defaultLayer: "composition",
};

function started(): FormSession {
	const session: FormSession = { formSessionId: "fs", chatId: "c", artifactRef: { name: "places" }, events: [], createdAt: "2026-01-01T00:00:00.000Z" };
	const result = execute(session, createAsterdocRuntime(artifact), { kind: "start" }, USER);
	if (!result.ok) throw new Error(result.reason);
	return result.session;
}

describe("answers to country and region fields", () => {
	it("store codes for names, with the full field reaching validation", () => {
		const runtime = createAsterdocRuntime(artifact);
		expect(runtime.validateField("birthCountry", "Canada")).toEqual({ ok: true, value: "CA" });
		expect(runtime.validateField("state", "Texas")).toEqual({ ok: true, value: "US-TX" });
		expect(runtime.validateField("home", '{"line1":"1 Bay St","locality":"Toronto","state":"Ontario","postalCode":"M5J 2N8","country":"Canada"}'))
			.toEqual({ ok: true, value: { line1: "1 Bay St", locality: "Toronto", region: "ON", postalCode: "M5J 2N8", country: "CA" } });
		expect(runtime.validateField("previous[0].country", "France")).toEqual({ ok: true, value: "FR" });
	});

	it("accept a name in the session locale only when the session sets it", () => {
		expect(createAsterdocRuntime(artifact, { locale: "de-DE" }).validateField("birthCountry", "Frankreich")).toEqual({ ok: true, value: "FR" });
		expect(createAsterdocRuntime(artifact).validateField("birthCountry", "Frankreich")).toMatchObject({ ok: false });
	});

	it("keep the outcome code and candidates on a refused value", () => {
		expect(createAsterdocRuntime(artifact).validateField("birthCountry", "Georgia")).toEqual({
			ok: false,
			issues: [{
				fieldPath: "fields.birthCountry",
				message: expect.any(String),
				code: "ambiguous_country",
				candidates: [{ code: "GE", name: "Georgia" }, { code: "US-GA", name: "Georgia, United States" }],
			}],
		});
	});

	it("carry the issues on a rejected answer command", () => {
		const result = execute(started(), createAsterdocRuntime(artifact), { kind: "answer", fieldPath: "state", value: "Ontario", source: "user" }, USER);
		expect(result).toMatchObject({ ok: false, code: "invalid-value", issues: [{ fieldPath: "fields.state", code: "unknown_region" }] });
		const candidates = result.ok ? [] : result.issues?.[0]?.candidates ?? [];
		expect(candidates).toHaveLength(5);
		expect(candidates.every((candidate) => candidate.code.startsWith("US-"))).toBe(true);
	});

	it("record the stored code on an accepted answer", () => {
		const result = execute(started(), createAsterdocRuntime(artifact), { kind: "answer", fieldPath: "birthCountry", value: "Deutschland", source: "user" }, USER);
		expect(result.ok && result.emitted).toEqual([expect.objectContaining({ t: "FieldAnswered", value: "DE" })]);
	});
});

describe("a write to one member of an address", () => {
	const runtime = createAsterdocRuntime(artifact);
	const toronto = { line1: "1 Bay St", locality: "Toronto", region: "ON", postalCode: "M5J 2N8", country: "CA" };

	function withHome(): FormSession {
		const result = execute(started(), runtime, { kind: "answer", fieldPath: "home", value: toronto, source: "user" }, USER);
		if (!result.ok) throw new Error(result.reason);
		return result.session;
	}

	it("resolves to the address that holds it, and only for a member the shape has", () => {
		expect(runtime.hasField("home.region")).toBe(false);
		expect(runtime.memberOf?.("home.region")).toEqual({ fieldPath: "home", member: "region" });
		expect(runtime.memberOf?.("home.planet")).toBeUndefined();
		expect(runtime.memberOf?.("birthCountry")).toBeUndefined();
		expect(runtime.memberOf?.("birthCountry.region")).toBeUndefined();
		expect(runtime.memberOf?.("postal.country")).toBeUndefined();
		expect(runtime.memberOf?.("price.amount")).toBeUndefined();
	});

	it("leaves members of an address without codes and of other composites unknown", () => {
		expect(execute(started(), runtime, { kind: "answer", fieldPath: "postal.country", value: "Canada", source: "user" }, USER))
			.toMatchObject({ ok: false, code: "field-not-found" });
		const priced = execute(started(), runtime, { kind: "answer", fieldPath: "price", value: { amount: 10, currency: "USD" }, source: "user" }, USER);
		if (!priced.ok) throw new Error(priced.reason);
		expect(execute(priced.session, runtime, { kind: "revise", fieldPath: "price.amount", value: 20, source: "user" }, USER))
			.toMatchObject({ ok: false, code: "field-not-found" });
		expect(execute(priced.session, runtime, { kind: "answer", fieldPath: "price.amount", value: 20, source: "user" }, USER))
			.toMatchObject({ ok: false, code: "field-not-found" });
	});

	it("revises the stored address with the member's code, in the address country", () => {
		const result = execute(withHome(), runtime, { kind: "answer", fieldPath: "home.region", value: "Quebec", source: "user" }, USER);
		expect(result.ok && result.emitted).toEqual([
			expect.objectContaining({ t: "FieldRevised", fieldPath: "home", previous: toronto, value: { ...toronto, region: "QC" } }),
		]);
	});

	it("refuses an ambiguous country member with its candidates and stores nothing", () => {
		const session = withHome();
		const result = execute(session, runtime, { kind: "revise", fieldPath: "home.country", value: "Georgia", source: "user" }, USER);
		expect(result).toMatchObject({
			ok: false,
			code: "invalid-value",
			issues: [{
				fieldPath: "fields.home.country",
				code: "ambiguous_country",
				candidates: [{ code: "GE", name: "Georgia" }, { code: "US-GA", name: "Georgia, United States" }],
			}],
		});
	});

	it("refuses a country member that does not hold the stored region", () => {
		const result = execute(withHome(), runtime, { kind: "answer", fieldPath: "home.country", value: "United States", source: "user" }, USER);
		expect(result).toMatchObject({ ok: false, code: "invalid-value", issues: [{ fieldPath: "fields.home.region", code: "unknown_region" }] });
	});

	it("refuses a member of an unanswered address, which leaves the other members missing", () => {
		const session = started();
		const result = execute(session, runtime, { kind: "answer", fieldPath: "home.country", value: "Canada", source: "user" }, USER);
		expect(result).toMatchObject({ ok: false, code: "invalid-value" });
		expect(result.ok ? [] : result.issues?.map((issue) => issue.fieldPath)).toContain("fields.home.line1");
	});

	it("keeps rejecting a path that is neither a field nor a member", () => {
		const result = execute(withHome(), runtime, { kind: "answer", fieldPath: "home.planet", value: "Mars", source: "user" }, USER);
		expect(result).toMatchObject({ ok: false, code: "field-not-found" });
	});
});
