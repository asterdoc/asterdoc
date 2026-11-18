import { describe, expect, it, test } from 'vitest'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, SCHEMA_VERSIONS, schemaVersionUrl } from '@asterdoc/schemas'
import { MIGRATION_STEPS, SchemaMigrationError, migrateArtifact } from '@/migration'
import { validate } from '@/validation/artifact'

describe('the published migration steps', () => {
	test('a step leads from every published version to the next, in order', () => {
		const pairs = SCHEMA_VERSIONS.slice(1).map((to, index) => `${SCHEMA_VERSIONS[index]}->${to}`)
		expect(MIGRATION_STEPS.map((step) => `${step.from}->${step.to}`)).toEqual(pairs)
	})

	test('an artifact of every published version reaches the current one', () => {
		for (const version of SCHEMA_VERSIONS) {
			const result = migrateArtifact({ $schema: schemaVersionUrl(version), kind: 'document', name: 'notice' })
			if (version === SCHEMA_VERSION) expect(result.status).toBe('current')
			else expect(result).toMatchObject({ status: 'migrated', from: version, to: SCHEMA_VERSION, artifact: { $schema: ASTERDOC_SCHEMA_URL } })
		}
	})
})

describe('the 2026-10-28 to 2026-11-06 step', () => {
	const form = {
		$schema: schemaVersionUrl('2026-10-28'),
		kind: 'form',
		name: 'lease',
		version: '1.0.0',
		title: 'Lease',
		fields: { signed: { type: 'date', label: 'Signed on' } },
		defaultLayer: 'pdf',
		layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: './lease.pdf' } },
	}

	test('changes only $schema on a form with fields and a PDF layer', () => {
		const result = migrateArtifact(form)

		expect(result.status).toBe('migrated')
		if (result.status !== 'migrated') return
		expect(result.from).toBe('2026-10-28')
		expect(result.to).toBe(SCHEMA_VERSION)
		const { $schema, ...rest } = result.artifact
		const { $schema: _old, ...before } = form
		expect($schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(rest).toEqual(before)
	})

	test('leaves its input unchanged', () => {
		const input = structuredClone(form)
		migrateArtifact(input)
		expect(input).toEqual(form)
	})
})

describe('the 2026-11-10 to 2026-11-12 step', () => {
	const form = (bindings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
		$schema: schemaVersionUrl('2026-11-10'),
		kind: 'form',
		name: 'lease',
		version: '1.0.0',
		title: 'Lease',
		fields: {
			tenant: { type: 'text', label: 'Tenant' },
			signed: { type: 'date', label: 'Signed on' },
			home: { type: 'address', label: 'Home' },
			rows: { type: 'list', label: 'Rows', maxItems: 2, item: { type: 'fieldset', label: 'Row', fields: { name: { type: 'text', label: 'Name' } } } },
		},
		defs: { total: { type: 'number', value: '1 + 1' } },
		parties: { owner: { label: 'Owner', partyType: 'person' } },
		defaultLayer: 'pdf',
		layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: './lease.pdf', bindings } },
		...extra,
	})

	const upgraded = (bindings: Record<string, unknown>): Record<string, unknown> => {
		const result = migrateArtifact(form(bindings))
		if (result.status !== 'migrated') throw new Error(`Expected a migration, got ${result.status}`)
		expect(result.from).toBe('2026-11-10')
		expect(result.artifact.$schema).toBe(ASTERDOC_SCHEMA_URL)
		return (result.artifact.layers as { pdf: { bindings: Record<string, unknown> } }).pdf.bindings
	}

	const refusal = (bindings: Record<string, unknown>): string => {
		try {
			migrateArtifact(form(bindings))
		} catch (error) {
			if (error instanceof SchemaMigrationError) {
				expect(error.code).toBe('unconvertible-value')
				return error.message
			}
			throw error
		}
		throw new Error('Expected the migration to refuse the artifact')
	}

	test('turns a comma-joined string binding into the template that prints the same text', () => {
		expect(upgraded({ name: 'home.locality, home.region,home.postalCode' })).toEqual({
			name: {
				template: '{{fields.home.locality}}'
					+ '{{#if isNotEmpty(fields.home.region)}}{{#if isNotEmpty(fields.home.locality)}}, {{/if}}{{fields.home.region}}{{/if}}'
					+ '{{#if isNotEmpty(fields.home.postalCode)}}{{#if isNotEmpty(fields.home.locality) or isNotEmpty(fields.home.region)}}, {{/if}}{{fields.home.postalCode}}{{/if}}',
			},
		})
	})

	test('keeps the format of a joined binding object', () => {
		expect(upgraded({ name: { path: 'tenant, signed', format: { date: { pattern: 'MM/DD/YYYY' } } } })).toEqual({
			name: {
				template: '{{fields.tenant}}{{#if isNotEmpty(fields.signed)}}{{#if isNotEmpty(fields.tenant)}}, {{/if}}{{fields.signed}}{{/if}}',
				format: { date: { pattern: 'MM/DD/YYYY' } },
			},
		})
	})

	test('writes each path from its root: a field, a list row, a party, a computed value', () => {
		const { name } = upgraded({ name: 'fields.tenant, rows.0.name, rows[1].name, parties.owner.name, defs.total' }) as { name: { template: string } }
		expect(name.template.startsWith('{{fields.tenant}}{{#if isNotEmpty(fields.rows[0].name)}}')).toBe(true)
		expect(name.template).toContain('{{fields.rows[1].name}}')
		expect(name.template).toContain('{{parties.owner.name}}')
		expect(name.template.endsWith('{{total}}{{/if}}')).toBe(true)
	})

	test('leaves every other binding as it is', () => {
		const bindings = {
			a: 'tenant',
			b: 'fields.signed',
			c: 'tenant:2',
			d: { path: 'signed', part: 'year' },
			e: { path: 'signed', format: { date: { pattern: 'MM/DD/YYYY' } } },
		}
		expect(upgraded(bindings)).toEqual(bindings)
	})

	test('converts the bindings of every layer, and leaves a layer without bindings alone', () => {
		const result = migrateArtifact(form({ name: 'tenant, signed' }, {
			layers: {
				pdf: { kind: 'file', mimeType: 'application/pdf', path: './lease.pdf', bindings: { name: 'tenant, signed' } },
				copy: { kind: 'file', mimeType: 'application/pdf', path: './copy.pdf', bindings: { name: 'signed, tenant' } },
				reuse: { kind: 'file', mimeType: 'application/pdf', path: './reuse.pdf', bindingsFrom: 'pdf' },
				summary: { kind: 'inline', mimeType: 'text/markdown', text: 'Tenant {{fields.tenant}}, signed {{fields.signed}}.' },
			},
		}))
		if (result.status !== 'migrated') throw new Error('Expected a migration')
		const layers = result.artifact.layers as Record<string, { bindings?: Record<string, { template: string }>; bindingsFrom?: string; text?: string }>
		expect(layers.pdf!.bindings!.name!.template.startsWith('{{fields.tenant}}')).toBe(true)
		expect(layers.copy!.bindings!.name!.template.startsWith('{{fields.signed}}')).toBe(true)
		expect(layers.reuse).toEqual({ kind: 'file', mimeType: 'application/pdf', path: './reuse.pdf', bindingsFrom: 'pdf' })
		expect(layers.summary!.text).toBe('Tenant {{fields.tenant}}, signed {{fields.signed}}.')
	})

	test('converts a form inside a bundle', () => {
		const result = migrateArtifact({
			$schema: schemaVersionUrl('2026-11-10'),
			kind: 'bundle',
			name: 'packet',
			version: '1.0.0',
			title: 'Packet',
			contents: [{ type: 'inline', key: 'lease', artifact: { ...form({ name: 'tenant, signed' }), $schema: undefined } }],
		})
		if (result.status !== 'migrated') throw new Error('Expected a migration')
		const [item] = result.artifact.contents as [{ artifact: { layers: { pdf: { bindings: { name: { template: string } } } } } }]
		expect(item.artifact.layers.pdf.bindings.name.template).toContain('{{fields.tenant}}')
	})

	test('gives a result the current schema and binding checks accept', () => {
		const result = migrateArtifact(form({ name: 'tenant, signed, home.locality', other: { path: 'parties.owner.name, defs.total', format: { case: 'upper' } } }))
		expect(result.status).toBe('migrated')
		expect(validate(result.artifact).issues).toBeUndefined()
	})

	test('refuses a joined binding that names a part, an empty path, or a qualifier', () => {
		expect(refusal({ name: { path: 'signed, tenant', part: 'year' } })).toContain('Cannot convert layers.pdf.bindings.name = {"path":"signed, tenant","part":"year"}: a joined binding prints whole values, so it takes no part')
		expect(refusal({ name: 'tenant,,signed' })).toContain('Cannot convert layers.pdf.bindings.name = "tenant,,signed": Binding "tenant,,signed" has an empty path.')
		expect(refusal({ name: 'tenant:1, signed' })).toContain('qualifies a part of a joined binding')
	})

	test('refuses a join whose template would be longer than the schema takes', () => {
		const many = Array.from({ length: 12 }, () => 'home.postalCode').join(', ')
		expect(refusal({ name: many })).toContain('the template that prints the same text is longer than 2000 characters; write the binding as a template.')
	})

	test('leaves its input unchanged', () => {
		const input = form({ name: 'tenant, signed' })
		const before = structuredClone(input)
		migrateArtifact(input)
		expect(input).toEqual(before)
	})
})

describe('the 2026-11-12 to 2026-11-17 step', () => {
	const form = (phone: Record<string, unknown>) => ({
		$schema: schemaVersionUrl('2026-11-12'),
		kind: 'form',
		name: 'contact',
		version: '1.0.0',
		title: 'Contact',
		fields: { phone },
		defaultLayer: 'pdf',
		layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: './contact.pdf', bindings: { area: { path: 'phone', part: 'areaCode' } } } },
	})

	test('adds nothing: a phone that states its countryCode migrates with only $schema changed', () => {
		const input = form({ type: 'phone', countryCode: '1' })
		const result = migrateArtifact(input)
		expect(result.status).toBe('migrated')
		if (result.status !== 'migrated') return
		const { $schema, ...rest } = result.artifact
		const { $schema: _old, ...before } = input
		expect($schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(rest).toEqual(before)
	})

	test('refuses to migrate an area code binding on a phone of every plan, naming the countryCode to add', () => {
		const error = (() => {
			try {
				migrateArtifact(form({ type: 'phone' }))
			} catch (caught) {
				return caught
			}
		})()
		expect(error).toBeInstanceOf(SchemaMigrationError)
		expect((error as Error).message).toContain('layers.pdf.bindings.area: Layer "pdf", binding "area": prints phone, but the part "areaCode" exists only for +1 numbers, and fields.phone accepts numbers of every plan; give the field "countryCode": "1".')
	})
})

describe('the step to 2026-11-17', () => {
	const step = MIGRATION_STEPS.find((candidate) => candidate.to === '2026-11-17')

	it('comes from 2026-11-12 and changes nothing in the artifact', () => {
		expect(step?.from).toBe('2026-11-12')
		const artifact = { kind: 'form', name: 'x', fields: {} }
		expect(step?.apply(structuredClone(artifact) as never)).toEqual(artifact)
	})

	it('names in its summary each thing the date adds: countryCode and the two standard font names', () => {
		expect(step?.summary).toContain('countryCode')
		expect(step?.summary).toContain('"Helvetica"')
		expect(step?.summary).toContain('"Courier"')
	})
})
