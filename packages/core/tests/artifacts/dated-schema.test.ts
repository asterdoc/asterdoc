import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Bundle, Checklist, Document, Form } from '@asterdoc/types'
import { parse as parseYaml } from 'yaml'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, readSchemaAddress } from '@asterdoc/schemas'
import { document, form } from '@/artifacts'
import { SchemaVersionError } from '@/serialization'

describe('serialized artifacts carry the current dated $schema', () => {
	test('the address names the current version', () => {
		expect(ASTERDOC_SCHEMA_URL).toBe(`https://schema.asterdoc.com/${SCHEMA_VERSION}.json`)
		expect(readSchemaAddress(ASTERDOC_SCHEMA_URL)).toEqual({ kind: 'known', version: SCHEMA_VERSION })
	})

	test('a builder artifact writes it first in JSON and YAML', () => {
		const notice = document({ name: 'notice', title: 'Notice' })
		expect(Object.keys(notice.toJSON())[0]).toBe('$schema')
		expect(notice.toJSON()).toMatchObject({ $schema: ASTERDOC_SCHEMA_URL })

		const yaml = notice.toYAML()
		expect(yaml).toContain(`\n$schema: ${ASTERDOC_SCHEMA_URL}\n`)
		expect(parseYaml(yaml)).toMatchObject({ $schema: ASTERDOC_SCHEMA_URL, kind: 'document', name: 'notice' })
	})

	test('an artifact read with the current address writes it back', () => {
		const read = form.from({ $schema: ASTERDOC_SCHEMA_URL, kind: 'form', name: 'intake', fields: {} })
		expect(read.toJSON()).toMatchObject({ $schema: ASTERDOC_SCHEMA_URL })
		expect(parseYaml(read.toYAML()).$schema).toBe(ASTERDOC_SCHEMA_URL)
	})

	test('an artifact with another address is refused, so nothing restamps it unmigrated', () => {
		expect(() =>
			form.from({ $schema: 'https://schema.asterdoc.com/schema.json', kind: 'form', name: 'intake', fields: {} }),
		).toThrow(SchemaVersionError)
	})

	test('every artifact type declares an optional $schema string', () => {
		expectTypeOf<Form['$schema']>().toEqualTypeOf<string | undefined>()
		expectTypeOf<Document['$schema']>().toEqualTypeOf<string | undefined>()
		expectTypeOf<Checklist['$schema']>().toEqualTypeOf<string | undefined>()
		expectTypeOf<Bundle['$schema']>().toEqualTypeOf<string | undefined>()
		const json: Form = form({ name: 'intake' }).toJSON()
		expect(json.$schema).toBe(ASTERDOC_SCHEMA_URL)
	})

	test('includeSchema: false writes no $schema at all', () => {
		const read = form.from({ $schema: ASTERDOC_SCHEMA_URL, kind: 'form', name: 'intake', fields: {} })
		expect(read.toJSON({ includeSchema: false })).not.toHaveProperty('$schema')
		const yaml = read.toYAML({ includeSchema: false })
		expect(yaml).not.toContain('$schema')
	})

	test('serializing leaves the input and the instance unchanged', () => {
		const input = { $schema: ASTERDOC_SCHEMA_URL, kind: 'form' as const, name: 'intake', fields: {} }
		const read = form.from(input)
		expect(read.toJSON({ includeSchema: false })).not.toHaveProperty('$schema')
		expect(input.$schema).toBe(ASTERDOC_SCHEMA_URL)
		expect(Object.keys(read.toJSON())[0]).toBe('$schema')
		expect(Object.keys(read.toJSON()).filter((key) => key === '$schema')).toHaveLength(1)
	})
})
