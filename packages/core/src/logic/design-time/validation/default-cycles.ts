import type { Expression, Form, FormField } from '@asterdoc/types'
import { parseExpression } from './expression-parser'
import type { LogicValidationIssue } from './shared'

interface Condition {
	readonly expression: string
	readonly rows: readonly string[]
}

interface DefaultSite {
	readonly key: string
	readonly path: string
	readonly conditions: readonly Condition[]
}

function conditionOf(field: FormField, rows: readonly string[]): Condition[] {
	return typeof field.visible === 'string' ? [{ expression: field.visible, rows }] : []
}

function defaultSites(form: Form): DefaultSite[] {
	const sites: DefaultSite[] = []
	const visit = (field: FormField, key: string, path: string, rows: readonly string[], inherited: readonly Condition[]): void => {
		const conditions = [...inherited, ...conditionOf(field, rows)]
		if ((field as { default?: unknown }).default !== undefined) sites.push({ key, path, conditions })
		if (field.type === 'fieldset') {
			for (const [id, child] of Object.entries(field.fields)) visit(child, `${key}.${id}`, `${path}.${id}`, rows, conditions)
		} else if (field.type === 'list') {
			visit(field.item, `${key}[]`, path, [...rows, path], conditions)
		}
	}
	for (const [id, field] of Object.entries(form.fields ?? {})) visit(field, id, id, [], [])
	return sites
}

function referencedPaths(expression: string, rows: readonly string[], defs: ReadonlySet<string>): string[] {
	const parsed = parseExpression(expression)
	if (!parsed.success) return []
	return parsed.variables.flatMap((variable) => {
		const path = variable.replace(/\[\d+\]/g, '')
		const [root, ...rest] = path.split('.')
		if (root === 'fields') return [rest.join('.')]
		if (root === 'item' && rows.length > 0) return [[rows[rows.length - 1], ...rest].join('.')]
		if (root === 'parent' && rows.length > 1) return [[rows[rows.length - 2], ...rest].join('.')]
		if (root !== undefined && defs.has(root)) return [`defs.${root}`]
		return []
	})
}

function definitionExpressions(expression: Expression): string[] {
	const value = (expression as { value: unknown }).value
	if (typeof value === 'string') return [value]
	if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).filter((entry): entry is string => typeof entry === 'string')
	return []
}

function touches(site: DefaultSite, path: string): boolean {
	return site.path === path || site.path.startsWith(`${path}.`) || path.startsWith(`${site.path}.`)
}

function reachesItself(start: string, dependsOn: ReadonlyMap<string, ReadonlySet<string>>): boolean {
	const stack = [...(dependsOn.get(start) ?? [])]
	const seen = new Set<string>()
	while (stack.length > 0) {
		const node = stack.pop()!
		if (node === start) return true
		if (seen.has(node)) continue
		seen.add(node)
		stack.push(...(dependsOn.get(node) ?? []))
	}
	return false
}

export function defaultCycleIssues(form: Form): LogicValidationIssue[] {
	const sites = defaultSites(form)
	if (sites.length === 0) return []
	const defs = new Set(Object.keys(form.defs ?? {}))
	const nodesFor = (paths: readonly string[]): string[] =>
		paths.flatMap((path) => (path.startsWith('defs.') ? [path] : sites.filter((site) => touches(site, path)).map((site) => site.key)))
	const dependsOn = new Map<string, Set<string>>()
	for (const site of sites) {
		dependsOn.set(site.key, new Set(site.conditions.flatMap((condition) => nodesFor(referencedPaths(condition.expression, condition.rows, defs)))))
	}
	for (const [key, expression] of Object.entries(form.defs ?? {})) {
		dependsOn.set(`defs.${key}`, new Set(definitionExpressions(expression).flatMap((text) => nodesFor(referencedPaths(text, [], defs)))))
	}
	const looped = sites.filter((site) => reachesItself(site.key, dependsOn)).map((site) => `fields.${site.key}`)
	if (looped.length === 0) return []
	return [{
		message: `The defaults of ${looped.join(', ')} decide whether these fields apply: a visible condition reads a default that it shows or hides. A default applies only while its field is visible, so these defaults never settle. Remove a default or change a condition so no default decides its own visibility.`,
		path: ['fields'],
	}]
}
