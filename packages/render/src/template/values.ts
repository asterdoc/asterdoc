import type { Form, FormField, FormParty } from '@asterdoc/types'

/**
 * What an artifact declares about the value at one template path: its
 * presentation kind and the field, definition, party, or annex behind it.
 * `path` names the value in messages, such as `fields.lines[0].amount`.
 */
export type DeclaredValue =
  | { source: 'field'; kind: string; field: FormField; path: string }
  | { source: 'definition'; kind: string; path: string }
  | { source: 'party'; kind: 'party' | 'parties'; role: string; party: FormParty; path: string }
  | { source: 'annex'; kind: 'attachment'; slot: string; path: string }
  | { source: 'member'; kind: string; owner: DeclaredValue; member: string; path: string }

/**
 * The semantic path resolver template checking and rendering share. It tells
 * what an artifact declares at a root-anchored path, such as
 * `['fields', 'lines', '0', 'amount']` or `['parties', 'tenant']`, so format
 * modifiers can be checked against a field's type and applied with its
 * metadata. List indexes are literal segments; at check time any index stands
 * for every row.
 *
 * `@asterdoc/render` builds one from a form with {@link formValueResolver};
 * a host with its own artifact model can supply another.
 */
export interface TemplateValueResolver {
  /** What the artifact declares at `segments`, or undefined when it declares nothing there. */
  describe(segments: readonly string[]): DeclaredValue | undefined
}

function isIndex(segment: string | undefined): segment is string {
  return segment !== undefined && /^\d+$/.test(segment)
}

function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

const TEXT = 'text'
const PERSON_MEMBERS = { name: TEXT, title: TEXT, firstName: TEXT, middleName: TEXT, lastName: TEXT, suffix: TEXT }
const ORGANIZATION_MEMBERS = { name: TEXT, legalName: TEXT, domicile: TEXT, entityType: TEXT, entityId: TEXT, taxId: TEXT }

/**
 * The presentation kind of each member of a structured value, by the kind of
 * the value that holds it. A member this table does not name is `unknown`.
 */
export const MEMBER_KINDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  money: { amount: 'number', currency: TEXT },
  address: { line1: TEXT, line2: TEXT, locality: TEXT, region: 'region', postalCode: TEXT, country: 'country' },
  phone: { number: TEXT, type: TEXT, extension: TEXT },
  coordinate: { lat: 'number', lon: 'number' },
  bbox: { southWest: 'coordinate', northEast: 'coordinate' },
  person: PERSON_MEMBERS,
  organization: ORGANIZATION_MEMBERS,
  party: { ...PERSON_MEMBERS, ...ORGANIZATION_MEMBERS },
  identification: { type: TEXT, number: TEXT, issuer: TEXT, issueDate: 'date', expiryDate: 'date' },
  attachment: { name: TEXT, mimeType: TEXT, checksum: TEXT },
}

function member(owner: DeclaredValue, members: readonly string[]): DeclaredValue {
  let declared = owner
  for (const name of members) {
    const kind = own(MEMBER_KINDS[declared.kind], name) ?? 'unknown'
    declared = { source: 'member', kind, owner: declared, member: name, path: `${declared.path}.${name}` }
  }
  return declared
}

function fieldAt(field: FormField, path: string, segments: readonly string[]): DeclaredValue | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined) return { source: 'field', kind: field.type, field, path }
  if (field.type === 'list') return isIndex(segment) ? fieldAt(field.item, `${path}[${segment}]`, rest) : undefined
  if (field.type === 'fieldset') {
    const child = own(field.fields, segment)
    return child ? fieldAt(child, `${path}.${segment}`, rest) : undefined
  }
  return member({ source: 'field', kind: field.type, field, path }, segments)
}

/** The resolver for a form's fields, computed values, parties, and annexes. */
export function formValueResolver(form: Form): TemplateValueResolver {
  return {
    describe(segments) {
      const [head, key, ...rest] = segments
      if (head === undefined) return undefined
      if (head === 'fields') {
        const field = key === undefined ? undefined : own(form.fields, key)
        return field ? fieldAt(field, `fields.${key}`, rest) : undefined
      }
      if (head === 'parties') {
        const party = key === undefined ? undefined : own(form.parties, key)
        if (!party || key === undefined) return undefined
        const path = `parties.${key}`
        if ((party.max ?? 1) > 1) {
          const [index, ...members] = rest
          if (index === undefined) return { source: 'party', kind: 'parties', role: key, party, path }
          if (!isIndex(index)) return undefined
          return member({ source: 'party', kind: 'party', role: key, party, path: `${path}[${index}]` }, members)
        }
        return member({ source: 'party', kind: 'party', role: key, party, path }, rest)
      }
      if (head === 'annexes') {
        if (key === undefined || (!own(form.annexes, key) && !form.allowAdditionalAnnexes)) return undefined
        return member({ source: 'annex', kind: 'attachment', slot: key, path: `annexes.${key}` }, rest)
      }
      const definition = own(form.defs, head)
      if (!definition) return undefined
      return member({ source: 'definition', kind: definition.type, path: head }, segments.slice(1))
    },
  }
}
