import { parse, type Expr } from '@asterdoc/expr'
import type { Form, FormField } from '@asterdoc/types'
import { IDENTIFIER_MEMBERS, isSensitiveField, redactedValue } from '@asterdoc/render'
import { defsDependencyExpressions } from './defs-dependencies'

type Fields = Record<string, FormField> | undefined

/** The most elements of a list a printed value shows. */
export const PRINTED_LIST_LIMIT = 10

export { IDENTIFIER_MEMBERS, isSensitiveField, redactedValue }

function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
	return record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

/**
 * The field a dotted path below `fields.` names, walking fieldsets by key and
 * list rows into their item. A numeric segment selects a row, and only a list
 * has rows; a member name read through a list reads that member of each row.
 */
export function fieldAtSegments(fields: Fields, segments: readonly string[]): FormField | undefined {
	let scope = fields
	let field: FormField | undefined
	for (const segment of segments) {
		if (/^\d+$/.test(segment)) {
			if (field?.type !== 'list') return undefined
			field = field.item
			scope = field.type === 'fieldset' ? field.fields : undefined
			continue
		}
		while (field?.type === 'list') field = field.item
		if (field) scope = field.type === 'fieldset' ? field.fields : undefined
		field = own(scope, segment)
		if (!field) return undefined
	}
	return field
}

/** How a value prints: sensitive as a whole, or through its list element and members. */
export interface ValueNode {
	readonly sensitive: boolean
	readonly element?: () => ValueNode
	readonly members?: () => Readonly<Record<string, ValueNode>>
}

const leaf = (sensitive: boolean): ValueNode => ({ sensitive })

function identifierMembers(sensitive: boolean): Record<string, ValueNode> {
	return Object.fromEntries(IDENTIFIER_MEMBERS.map((member) => [member, leaf(sensitive)]))
}

function fieldNode(field: FormField, inherited: boolean): ValueNode {
	const sensitive = inherited || isSensitiveField(field)
	if (field.type === 'list') return { sensitive, element: () => fieldNode(field.item, sensitive) }
	if (field.type === 'fieldset') {
		return { sensitive, members: () => Object.fromEntries(Object.entries(field.fields).map(([key, child]) => [key, fieldNode(child, sensitive)])) }
	}
	if (field.type === 'organization') return { sensitive, members: () => identifierMembers(sensitive || field.sensitive !== false) }
	return leaf(sensitive)
}

function fieldsNode(fields: Fields): ValueNode {
	return { sensitive: false, members: () => Object.fromEntries(Object.entries(fields ?? {}).map(([key, field]) => [key, fieldNode(field, false)])) }
}

const partyNode: ValueNode = { sensitive: false, members: () => identifierMembers(true) }

function partiesNode(form: Form): ValueNode {
	return { sensitive: false, members: () => Object.fromEntries(Object.keys(form.parties ?? {}).map((role) => [role, partyNode])) }
}

function memberOf(node: ValueNode, key: string): ValueNode {
	return own(node.members?.(), key) ?? leaf(node.sensitive)
}

function step(node: ValueNode, segment: string): ValueNode {
	if (/^\d+$/.test(segment) && node.element) return node.element()
	let current = node
	while (current.element) current = current.element()
	return memberOf(current, segment)
}

function containsSensitive(node: ValueNode): boolean {
	if (node.sensitive) return true
	if (node.element && containsSensitive(node.element())) return true
	return Object.values(node.members?.() ?? {}).some(containsSensitive)
}

function printList(values: readonly unknown[], printElement: (value: unknown) => string): string {
	const shown = values.slice(0, PRINTED_LIST_LIMIT).map(printElement)
	const hidden = values.length - shown.length
	return `[${[...shown, ...(hidden > 0 ? [`… ${hidden} more`] : [])].join(', ')}]`
}

function printValue(value: unknown, node: ValueNode): string {
	if (value === undefined || value === null) return 'null'
	if (Array.isArray(value)) {
		const element = node.element?.() ?? node
		return printList(value, (item) => printValue(item, element))
	}
	if (node.sensitive) return redactedValue(value)
	if (typeof value === 'string') return JSON.stringify(value)
	if (typeof value !== 'object') return String(value)
	const entries = Object.entries(value as Record<string, unknown>).map(([key, member]) => `${JSON.stringify(key)}: ${printValue(member, memberOf(node, key))}`)
	return `{${entries.join(', ')}}`
}

/** How a read path's value prints. */
export interface ValuePrinter {
	/** The printed value at a path the expression reads. */
	print(path: string, value: unknown): string
	/** Whether an expression's result or error can reveal a sensitive value; see {@link FormSensitivity.reveals}. */
	reveals(expression: string): boolean
}

/** How values are printed: `raw` prints sensitive values as they are. */
export interface PrintOptions {
	readonly raw?: boolean
}

/** The `fields.` paths of the lists whose rows a row expression binds as `item` and `parent`. */
export interface RowListPaths {
	readonly item?: { readonly listPath: string }
	readonly parent?: { readonly listPath: string }
}

/** Which of a form's values are sensitive, as the paths an expression reads name them. */
export interface FormSensitivity {
	/** The value node a read path lands on, and whether a computed value on it read a sensitive value. */
	nodeOf(path: string, rows?: RowListPaths): { node: ValueNode; derived: boolean }
	/** Whether a defs value is computed from a sensitive value. */
	isDerived(key: string): boolean
	/**
	 * Whether an expression's result or error can reveal a sensitive value: it
	 * reads one, a value holding one, or a derived defs value. Counting the
	 * rows of a list or a party role reveals nothing, so the list read by
	 * `count()`, or by `length()` of a list, is not a read here; a filter
	 * passed to `count()` is.
	 */
	reveals(expression: string, rows?: RowListPaths): boolean
	/**
	 * {@link reveals} for a template expression. A loop variable, or any root
	 * outside `roots` and the defs, could name any row, so reading one reveals
	 * when the form holds any sensitive value.
	 */
	revealsInTemplate(expression: string, roots: ReadonlySet<string>): boolean
	/** Whether the value at one read path is sensitive, holds one, or is derived from one. */
	pathReveals(path: string): boolean
	/** Whether a read path names a list or a party role, whose rows `count()` counts. */
	isList(path: string): boolean
	/** Whether the form holds any sensitive value. */
	holdsSensitive(): boolean
}

function pathOf(node: Expr): string | null {
	if (node.kind === 'Identifier') return node.name
	if (node.kind === 'Member') {
		const base = pathOf(node.object)
		return base === null ? null : `${base}.${node.property}`
	}
	if (node.kind === 'Index' && (node.index.kind === 'StringLiteral' || node.index.kind === 'NumberLiteral')) {
		const base = pathOf(node.object)
		return base === null ? null : `${base}.${node.index.value}`
	}
	return null
}

/**
 * The paths an expression reads that can reveal their values: every
 * reference except the list or party role that `count()`, or `length()` of a
 * list, only counts. A literal index reads like a member, so
 * `forms["source"].fields.pattern` reads `forms.source.fields.pattern`.
 */
export function revealingReads(expression: string, isList: (path: string) => boolean): string[] {
	const { ast } = parse(expression)
	if (!ast) return []
	const paths = new Set<string>()
	const visit = (node: Expr): void => {
		switch (node.kind) {
			case 'Identifier':
				paths.add(node.name)
				return
			case 'Member':
			case 'Index': {
				const path = pathOf(node)
				if (path !== null) paths.add(path)
				else if (node.kind === 'Member') visit(node.object)
				else {
					visit(node.object)
					visit(node.index)
				}
				return
			}
			case 'Unary':
				visit(node.operand)
				return
			case 'Binary':
			case 'Logical':
				visit(node.left)
				visit(node.right)
				return
			case 'Membership':
				visit(node.element)
				visit(node.collection)
				return
			case 'Conditional':
				visit(node.test)
				visit(node.consequent)
				visit(node.alternate)
				return
			case 'Call': {
				const [first, ...rest] = node.args
				const counted = first ? pathOf(first) : null
				const skip = counted !== null && (node.callee === 'count' || (node.callee === 'length' && isList(counted)))
				for (const arg of skip ? rest : node.args) visit(arg)
				return
			}
			case 'ArrayLiteral':
				for (const element of node.elements) visit(element)
				return
			default:
				return
		}
	}
	visit(ast)
	return [...paths]
}

/**
 * The sensitivity of a form's values. A path is read as rules read it: rooted
 * at `fields`, a defs key, `parties`, another context root, or a bare field
 * id. A defs value is derived when an expression it reads, directly or
 * through another defs value, reaches a sensitive value or a value that holds
 * one. The taxId and entityId of a party are sensitive.
 */
export function formSensitivity(form: Form, contextRoots: ReadonlySet<string> = new Set(['fields', 'parties'])): FormSensitivity {
	const defs = form.defs ?? {}
	let defExpressions: Record<string, string> | undefined
	const derived = new Map<string, boolean>()
	const fields = fieldsNode(form.fields)
	const parties = partiesNode(form)

	const resolve = (path: string, visiting: Set<string>, rows?: RowListPaths): { node: ValueNode; derived: boolean } => {
		const [first = '', ...after] = path.replace(/\[(\d+)\]/g, '.$1').split('.')
		const row = first === 'item' ? rows?.item : first === 'parent' ? rows?.parent : undefined
		const [root = '', ...rest] = row ? [...row.listPath.replace(/\[(\d+)\]/g, '.$1').split('.'), '0', ...after] : [first, ...after]
		if (own(defs, root) !== undefined) return { node: leaf(false), derived: defDerived(root, visiting) }
		let node: ValueNode
		if (root === 'fields') node = fields
		else if (root === 'parties') node = parties
		else if (contextRoots.has(root)) node = leaf(false)
		else return { node: rest.reduce(step, memberOf(fields, root)), derived: false }
		return { node: rest.reduce(step, node), derived: false }
	}

	const defDerived = (key: string, visiting: Set<string>): boolean => {
		const known = derived.get(key)
		if (known !== undefined) return known
		if (visiting.has(key)) return false
		visiting.add(key)
		defExpressions ??= form.defs ? defsDependencyExpressions(form.defs, form.fields) : {}
		const expression = defExpressions[key]
		const result = expression !== undefined && readsReveal(expression, visiting)
		visiting.delete(key)
		derived.set(key, result)
		return result
	}

	const isList = (path: string): boolean => /^parties\.[^.]+$/.test(path) || resolve(path, new Set()).node.element !== undefined

	const readsReveal = (expression: string, visiting: Set<string>, rows?: RowListPaths): boolean =>
		revealingReads(expression, isList).some((read) => {
			const target = resolve(read, visiting, rows)
			return target.derived || containsSensitive(target.node)
		})

	const pathReveals = (path: string): boolean => {
		const target = resolve(path, new Set())
		return target.derived || containsSensitive(target.node)
	}
	const holdsSensitive = (): boolean => containsSensitive(fields) || containsSensitive(parties)

	return {
		nodeOf: (path, rows) => resolve(path, new Set(), rows),
		isDerived: (key) => own(defs, key) !== undefined && defDerived(key, new Set()),
		reveals: (expression, rows) => readsReveal(expression, new Set(), rows),
		revealsInTemplate: (expression, roots) => revealingReads(expression, isList).some((read) => {
			const root = read.split('.')[0] ?? ''
			return own(defs, root) !== undefined || roots.has(root) ? pathReveals(read) : holdsSensitive()
		}),
		pathReveals,
		isList,
		holdsSensitive,
	}
}

/**
 * The printer for the paths a form's rules read. A derived defs value prints
 * redacted unless it is a boolean, which tells no more than the rule's own
 * result.
 */
export function formValuePrinter(form: Form, contextRoots: ReadonlySet<string>, options: PrintOptions = {}): ValuePrinter {
	const sensitivity = formSensitivity(form, contextRoots)
	return {
		print(path, value) {
			if (options.raw) return printValue(value, leaf(false))
			const { node, derived } = sensitivity.nodeOf(path)
			if (derived && typeof value !== 'boolean' && value !== null && value !== undefined) return redactedValue(value)
			return printValue(value, node)
		},
		reveals: (expression) => !options.raw && sensitivity.reveals(expression),
	}
}

/** The printer for values of unknown sensitivity: every value is redacted unless `raw`. */
export function redactingPrinter(options: PrintOptions = {}): ValuePrinter {
	return {
		print: (_path, value) => printValue(value, leaf(!options.raw)),
		reveals: () => !options.raw,
	}
}

/**
 * The paths of the sensitive values an input sets, such as `fields.ssn`,
 * `fields.owners[1].ssn` or `parties.employer.taxId`.
 */
export function sensitiveInputPaths(form: Form, input: { readonly fields?: unknown; readonly parties?: unknown }): string[] {
	const walk = (value: unknown, node: ValueNode, path: string): string[] => {
		if (value === null || value === undefined) return []
		if (node.sensitive) return [path]
		if (Array.isArray(value)) {
			const element = node.element?.() ?? node
			return value.flatMap((item, index) => walk(item, element, `${path}[${index}]`))
		}
		if (typeof value !== 'object') return []
		return Object.entries(value as Record<string, unknown>).flatMap(([key, member]) => walk(member, memberOf(node, key), `${path}.${key}`))
	}
	return [...walk(input.fields, fieldsNode(form.fields), 'fields'), ...walk(input.parties, partiesNode(form), 'parties')]
}

/**
 * A form's defs values as an agent may see them: a value computed from a
 * sensitive value prints redacted unless it is a boolean or missing.
 */
export function redactDefsValues(form: Form, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const sensitivity = formSensitivity(form)
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [
		key,
		sensitivity.isDerived(key) && typeof value !== 'boolean' && value !== null && value !== undefined ? redactedValue(value) : value,
	]))
}

/**
 * Read a dotted path from a rule's context as the expression reads it. A path
 * through a list reads every row, so the value is a list with one entry per
 * row; a numeric segment selects one row.
 */
export function readContextPath(context: Record<string, unknown>, path: string): unknown {
	return readSegments(context, path.split('.'))
}

function readSegments(current: unknown, segments: readonly string[]): unknown {
	if (segments.length === 0) return current
	const [segment, ...rest] = segments as [string, ...string[]]
	if (Array.isArray(current)) {
		if (/^\d+$/.test(segment)) return readSegments(current[Number(segment)], rest)
		return current.map((row) => readSegments(row, segments))
	}
	if (current === null || typeof current !== 'object' || segment === '__proto__') return undefined
	if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
	return readSegments((current as Record<string, unknown>)[segment], rest)
}
