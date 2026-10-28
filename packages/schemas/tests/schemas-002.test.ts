/**
 * schemas-002: individual schema $id does not match its published file name.
 * Input: every schemas/<version>/*.json file.
 * Expected: $id ends with `/<version>/<file name>` (e.g. form-field.json).
 * Actual: form-field.json carries $id .../<version>/formfield.json (12 such files).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../src/zod/config'

const dir = join(__dirname, '..', 'schemas', SCHEMA_VERSION)

describe('schemas-002', () => {
	it('each file $id names its own file', () => {
		const mismatches = readdirSync(dir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')).$id as string] as const)
			.filter(([f, id]) => id !== `https://schema.asterdoc.com/${SCHEMA_VERSION}/${f}`)
			.map(([f, id]) => `${f} -> ${id}`)
		expect(mismatches).toEqual([])
	})
})
