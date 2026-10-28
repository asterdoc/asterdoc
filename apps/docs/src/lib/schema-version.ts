import { SCHEMA_VERSION } from "@asterdoc/schemas";

/**
 * The schema version token for docs content.
 *
 * Docs pages never hand-write a schema version. A code block or inline code
 * span writes this token instead, and `remarkSchemaVersion` fills in
 * the value from `@asterdoc/schemas` at build time, so a schema version bump
 * updates every page. The token works only inside code: in prose, markdown
 * reads `__…__` as bold text.
 */
export const SCHEMA_VERSION_TOKEN = "__SCHEMA_VERSION__";

/** Replace every schema version token in `text` with its version. */
export function fillSchemaVersion(text: string): string {
	return text.replaceAll(SCHEMA_VERSION_TOKEN, SCHEMA_VERSION);
}

interface MdastNode {
	type: string;
	value?: unknown;
	children?: MdastNode[];
}

function fillNode(node: MdastNode): void {
	if (
		(node.type === "code" || node.type === "inlineCode") &&
		typeof node.value === "string"
	) {
		node.value = fillSchemaVersion(node.value);
	}
	for (const child of node.children ?? []) fillNode(child);
}

/** Remark plugin: fill schema version tokens in code blocks and inline code. */
export function remarkSchemaVersion() {
	return (tree: MdastNode) => fillNode(tree);
}
