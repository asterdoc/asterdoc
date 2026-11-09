import { formValueResolver, type TemplateValueResolver } from "@asterdoc/render/text";
import type { ModifierTarget } from "@asterdoc/render";
import type { Form } from "@asterdoc/types";
import { annexSlot, pathSegments } from "./fields";

const resolvers = new WeakMap<Form, TemplateValueResolver>();

function resolverOf(artifact: Form): TemplateValueResolver {
  let resolver = resolvers.get(artifact);
  if (!resolver) {
    resolver = formValueResolver(artifact);
    resolvers.set(artifact, resolver);
  }
  return resolver;
}

/** Every single value declared at `segments`: the value itself, or each leaf of a list or fieldset. */
function leafTargets(artifact: Form, segments: readonly string[]): ModifierTarget[] {
  const declared = resolverOf(artifact).describe(segments);
  if (!declared) return [];
  if (declared.source === "field" && declared.field.type === "list") return leafTargets(artifact, [...segments, "0"]);
  if (declared.source === "field" && declared.field.type === "fieldset") {
    return Object.keys(declared.field.fields).flatMap((key) => leafTargets(artifact, [...segments, key]));
  }
  return [{ kind: declared.kind, declared }];
}

/** The values a field path prints, as template modifiers see them. */
export function fieldTargets(artifact: Form, path: string): ModifierTarget[] {
  try {
    return leafTargets(artifact, ["fields", ...pathSegments(path)]);
  } catch {
    return [];
  }
}

/** The value a computed definition prints. */
export function definitionTargets(artifact: Form, name: string): ModifierTarget[] {
  return leafTargets(artifact, [name]);
}

/** The value an `annexes.<slot>` path prints. */
export function annexTargets(artifact: Form, path: string): ModifierTarget[] {
  try {
    const slot = annexSlot(path);
    return slot === undefined ? [] : leafTargets(artifact, ["annexes", slot]);
  } catch {
    return [];
  }
}

/** The name one party of a role prints. */
export function partyTargets(artifact: Form, role: string, index: number): ModifierTarget[] {
  const party = Object.hasOwn(artifact.parties ?? {}, role) ? artifact.parties?.[role] : undefined;
  if (!party) return [];
  return leafTargets(artifact, (party.max ?? 1) > 1 ? ["parties", role, String(index)] : ["parties", role]);
}
