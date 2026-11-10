import { CANONICAL_SHAPES, loadFromObject, type ValidationError } from "@asterdoc/core";
import type { Issue } from "../event-log/types";
import { assertCoercionOptions, coerceFieldValue, type CoercionOptions, type CoercionTarget } from "./coerce";
import { templateFieldPath, unflattenPaths } from "./payload";
import type { ArtifactRuntime, FillStateSnapshot } from "./types";

/**
 * Build an ArtifactRuntime backed by @asterdoc/core.
 *
 * The artifact object is loaded once; per-call we run safeFill against
 * the current answers and ask the resulting DraftForm for its FillState,
 * wrapped behind a tight interface so the engine remains independent of
 * core's evolving API.
 *
 * Performance: loadFromObject + safeFill is a few milliseconds for
 * typical artifacts; cheap enough to recompute on every command.
 *
 * `options.defaultCallingCode` (for example `"+1"`) is the only source of a
 * country code for a phone number given without one; see `coerce.ts`.
 */
export function createAsterdocRuntime(
	artifact: Record<string, unknown>,
	options: CoercionOptions = {},
): ArtifactRuntime {
	assertCoercionOptions(options);
	// Loaded once — pure design-time wrapper; doesn't capture answers.
	const instance = loadFromObject<"form">(artifact);

	// One walk of the field tree: the public list, the path set, and the type
	// index all come from it, so they cannot disagree about list items.
	const fieldList = walkFields(instance.fields);
	const knownFieldPaths = new Set(fieldList.map((f) => f.fieldPath));
	const coercionTargets = new Map<string, CoercionTarget>(
		fieldList.flatMap((f) => (f.target ? [[f.fieldPath, f.target] as const] : [])),
	);

	const partyList = Object.entries(instance.parties ?? {}).map(([roleId, def]) => ({
		roleId,
		...(def.label ? { label: def.label } : {}),
		partyType: def.partyType ?? ("any" as const),
		max: def.max ?? 1,
	}));
	const partyLabels = new Map(partyList.map((p) => [p.roleId, p.label]));

	const annexList = Object.entries(instance.annexes ?? {}).map(([annexId, def]) => ({
		annexId,
		...(def.title ? { label: def.title } : {}),
	}));
	const annexLabels = new Map(annexList.map((a) => [a.annexId, a.label]));

	function hasField(fieldPath: string): boolean {
		return knownFieldPaths.has(templateFieldPath(fieldPath));
	}

	const codedAddressPaths = new Set(
		fieldList.flatMap((f) =>
			f.target?.type === "address" && f.target.codes === true ? [f.fieldPath] : [],
		),
	);
	const addressMembers = new Set(
		[...CANONICAL_SHAPES.address.required, ...CANONICAL_SHAPES.address.optional].map((spec) => spec.name),
	);

	function memberOf(fieldPath: string): { fieldPath: string; member: string } | undefined {
		const dot = fieldPath.lastIndexOf(".");
		if (dot <= 0) return undefined;
		const owner = fieldPath.slice(0, dot);
		const member = fieldPath.slice(dot + 1);
		return codedAddressPaths.has(templateFieldPath(owner)) && addressMembers.has(member)
			? { fieldPath: owner, member }
			: undefined;
	}

	function hasParty(roleId: string): boolean {
		return partyLabels.has(roleId);
	}

	function hasAnnex(annexId: string): boolean {
		return annexLabels.has(annexId);
	}

	function getFillState(
		answers: Record<string, unknown>,
		parties: Record<string, unknown>,
		annexes: Record<string, unknown>,
	): FillStateSnapshot {
		// The session engine flattens answers to dot/bracket paths and holds
		// them independent of core's generic artifact type; unflattening them
		// back into a nested seed can't be checked against `Parameters<
		// typeof instance.safeFill>[0]` without re-deriving core's generic, so
		// this goes through `unknown` rather than `any` — the object shape
		// (fields/parties/annexes) is still enforced above, just not core's
		// exact per-field generic.
		const draft = instance.safeFill(
			{ fields: unflattenPaths(answers), parties, annexes } as unknown as Parameters<
				typeof instance.safeFill
			>[0],
		);
		if (!draft.success) {
			return {
				resolved: false,
				diagnostics: [draft.error.message],
				openRequired: [],
				openOptional: [],
				done: [],
				openRequiredParties: [],
				openRequiredAnnexes: [],
				openOptionalAnnexes: [],
			};
		}
		const runtimeState = draft.data.runtimeState;
		const fillState = draft.data.getFillState({ includeOptional: true });
		type Item = (typeof fillState.done)[number];
		const fields = (items: Item[]) =>
			items
				.filter((item) => item.kind === "field")
				.map((item) => ({ fieldPath: item.key, order: item.order, status: item.status }));
		const annexItems = (items: Item[]) =>
			items
				.filter((item) => item.kind === "annex")
				.map((item) => {
					const label = annexLabels.get(item.key);
					return { annexId: item.key, ...(label !== undefined ? { label } : {}), order: item.order };
				});
		return {
			resolved: runtimeState.resolved,
			...(runtimeState.issues.length > 0
				? { diagnostics: runtimeState.issues.map((issue) => issue.message) }
				: {}),
			openRequired: fields(fillState.openRequired),
			openOptional: fields(fillState.openOptional),
			done: fields(fillState.done),
			openRequiredParties: fillState.openRequired
				.filter((item) => item.kind === "party")
				.map((item) => {
					const label = partyLabels.get(item.key);
					return { roleId: item.key, ...(label !== undefined ? { label } : {}), order: item.order };
				}),
			openRequiredAnnexes: annexItems(fillState.openRequired),
			openOptionalAnnexes: annexItems(fillState.openOptional),
			candidates: fillState.candidates.map((c) => ({
				kind: c.kind,
				key: c.key,
				required: c.required,
				order: c.order,
			})),
		};
	}

	function validateField(
		fieldPath: string,
		value: unknown,
	): ReturnType<ArtifactRuntime["validateField"]> {
		const coerced = coerceFieldValue(
			coercionTargets.get(templateFieldPath(fieldPath)),
			value,
			options,
		);
		const result = instance.validateFieldInput({
			fieldPath,
			value: coerced,
			...(options.locale !== undefined ? { locale: options.locale } : {}),
		});
		if (result.success) {
			// Persist the value core's schema produced, not the input: e.g. "20"
			// is stored as the number 20, and any normalization core applies
			// reaches the event log.
			return { ok: true, value: result.value };
		}
		return { ok: false, issues: issuesOf(result.errors) };
	}

	function validateParty(
		roleId: string,
		value: unknown,
		index: number,
	): ReturnType<ArtifactRuntime["validateParty"]> {
		const result = instance.validatePartyInput({ roleId, index, value });
		if (result.success) {
			// validatePartyInput returns NormalizedPartyInput; we just need the
			// runtime party object for downstream serialization.
			return { ok: true, value: result.value.party };
		}
		return { ok: false, issues: issuesOf(result.errors) };
	}

	function validateAnnex(
		annexId: string,
		value: unknown,
	): ReturnType<ArtifactRuntime["validateAnnex"]> {
		const result = instance.validateAnnexInput({ annexId, value });
		if (result.success) return { ok: true, value: result.value };
		return { ok: false, issues: issuesOf(result.errors) };
	}

	return {
		hasField,
		memberOf,
		hasParty,
		hasAnnex,
		getFillState,
		validateField,
		validateParty,
		validateAnnex,
		listFields: () =>
			fieldList.map(({ fieldPath, required, type }) => ({
				fieldPath,
				required,
				...(type !== undefined ? { type } : {}),
			})),
		listParties: () => partyList.map((p) => ({ ...p })),
		listAnnexes: () => annexList.map((a) => ({ ...a })),
	};
}

function issuesOf(errors: ReadonlyArray<ValidationError>): Issue[] {
	return errors.map((e) => ({
		fieldPath: e.field,
		message: e.message,
		...(e.code !== undefined ? { code: e.code } : {}),
		...(e.candidates !== undefined ? { candidates: e.candidates.map(({ code, name }) => ({ code, name })) } : {}),
	}));
}

type FieldEntry = {
	fieldPath: string;
	required: boolean;
	type?: string;
	/** The field's definition, which value coercion reads. */
	target?: CoercionTarget;
};

/**
 * Walk an artifact's `fields` map and yield every field path, in declaration
 * order, with the dot-separated form @asterdoc/core's APIs use
 * (validateFieldInput, FillState keys). A fieldset is walked, not listed; a
 * list is listed and its item paths follow under `[]` (`items[].name`, or
 * `tags[]` for a list of scalars).
 */
function walkFields(fields: unknown, prefix = ""): FieldEntry[] {
	const out: FieldEntry[] = [];
	if (!fields || typeof fields !== "object") return out;
	for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${key}` : key;
		const def = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
		if (def && "fields" in def) {
			out.push(...walkFields(def.fields, path));
			continue;
		}
		out.push(entryOf(path, def));
		if (def?.type !== "list") continue;
		const item = def.item && typeof def.item === "object" ? (def.item as Record<string, unknown>) : null;
		if (item && "fields" in item) out.push(...walkFields(item.fields, `${path}[]`));
		else if (item) out.push(entryOf(`${path}[]`, item));
	}
	return out;
}

function entryOf(fieldPath: string, def: Record<string, unknown> | null): FieldEntry {
	const type = typeof def?.type === "string" ? def.type : undefined;
	return {
		fieldPath,
		required: def?.required === true,
		...(type !== undefined ? { type } : {}),
		...(def && type !== undefined ? { target: def as unknown as CoercionTarget } : {}),
	};
}
