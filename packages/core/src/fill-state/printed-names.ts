/**
 * Names a PDF layer prints from members a party does not give.
 *
 * A person carries `name`, and optionally `firstName`, `middleName` and
 * `lastName`. A PDF layer that binds its boxes to the split members prints
 * nothing for a party that gives only `name`. This module finds those parties.
 */

import type { Form } from '@asterdoc/types'
import { parseBindings, resolveLayerBindings, type LayerBindingsSpec } from '@asterdoc/render'
import type { FillBatchProblem, FillState, UnprintedPartyName } from './types'

const NAME_MEMBERS = new Set(['name', 'firstName', 'middleName', 'lastName'])

interface PrintedMember {
	layer: string
	role: string
	index: number | undefined
	member: string
}

const printedByForm = new WeakMap<Form, PrintedMember[]>()

function printedMemberOf(layer: string, path: string): PrintedMember | undefined {
	const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.')
	if (segments[0] !== 'parties' || segments[1] === undefined) return undefined
	const indexed = segments[2] !== undefined && /^\d+$/.test(segments[2])
	const member = indexed ? segments[3] : segments[2]
	if (member === undefined) return undefined
	return { layer, role: segments[1], index: indexed ? Number(segments[2]) : undefined, member }
}

function layerMembers(layers: Record<string, LayerBindingsSpec>, key: string): PrintedMember[] {
	try {
		const bindings = resolveLayerBindings(layers, layers[key]!)
		if (!bindings) return []
		return parseBindings(bindings).flatMap(({ parts }) => parts.flatMap((part) => printedMemberOf(key, part.path) ?? []))
	} catch {
		return []
	}
}

/** Every party member a PDF layer of the form prints, one entry per layer, role and member. */
function printedMembers(form: Form): PrintedMember[] {
	const known = printedByForm.get(form)
	if (known) return known
	const layers = (form.layers ?? {}) as Record<string, LayerBindingsSpec>
	const seen = new Set<string>()
	const found = Object.keys(layers)
		.flatMap((key) => layerMembers(layers, key))
		.filter((entry) => {
			const id = `${entry.layer}\u0000${entry.role}\u0000${entry.index ?? ''}\u0000${entry.member}`
			if (seen.has(id)) return false
			seen.add(id)
			return true
		})
	printedByForm.set(form, found)
	return found
}

/**
 * The members of a party role that a PDF layer of the form prints, in the
 * order the layers bind them. Empty when no PDF layer prints the role.
 */
export function printedPartyMembers(form: Form, role: string): string[] {
	return [...new Set(printedMembers(form).filter((entry) => entry.role === role).map((entry) => entry.member))]
}

function given(party: unknown, member: string): boolean {
	if (party === null || typeof party !== 'object') return false
	const value = (party as Record<string, unknown>)[member]
	return typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined
}

/**
 * The parties whose name does not print on a PDF layer: the layer prints the
 * name from members of the party, and the party gives none of those members.
 */
export function unprintedPartyNames(form: Form, parties: Record<string, unknown>): UnprintedPartyName[] {
	const printed = printedMembers(form).filter((entry) => NAME_MEMBERS.has(entry.member))
	if (printed.length === 0) return []
	const found: UnprintedPartyName[] = []
	for (const [role, value] of Object.entries(parties)) {
		if (value === null || value === undefined) continue
		const list: unknown[] = Array.isArray(value) ? value : [value]
		const ofRole = printed.filter((entry) => entry.role === role)
		for (const layer of new Set(ofRole.map((entry) => entry.layer))) {
			list.forEach((party, index) => {
				const members = ofRole.filter((entry) => entry.layer === layer && (entry.index === undefined ? list.length === 1 : entry.index === index)).map((entry) => entry.member)
				if (members.length === 0 || members.some((member) => given(party, member))) return
				found.push({ role, index, listed: Array.isArray(value), layer, members })
			})
		}
	}
	return found
}

function membersText(members: readonly string[]): string {
	return members.length === 1 ? members[0]! : `${members.slice(0, -1).join(', ')} and ${members[members.length - 1]!}`
}

/**
 * The parties a fill state lists as not printed by name, as problems at the
 * path of each party, with the members the layer prints.
 */
export function unprintedNameProblems(state: Pick<FillState, 'unprintedNames'>): FillBatchProblem[] {
	return state.unprintedNames.map((entry) => ({
		path: entry.listed ? `parties.${entry.role}[${entry.index}]` : `parties.${entry.role}`,
		message: `The "${entry.layer}" layer prints this party's name from ${membersText(entry.members)}, and the party gives ${entry.members.length === 1 ? 'no value for it' : 'none of them'}. Its name would not print. Give ${entry.members.length === 1 ? 'it' : 'them'} next to name.`,
	}))
}
