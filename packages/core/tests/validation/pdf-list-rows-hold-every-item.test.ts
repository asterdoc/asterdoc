import { describe, expect, it } from 'vitest'
import { validate } from '@/index'

const artifact = (lines: Record<string, unknown>, layers: Record<string, Record<string, unknown>>) => ({
	kind: 'form',
	name: 'rows',
	version: '1.0.0',
	title: 'Rows',
	fields: { lines },
	layers: Object.fromEntries(Object.entries(layers).map(([key, bindings]) => [key, { kind: 'file', mimeType: 'application/pdf', path: `${key}.pdf`, bindings }])),
})
const line = { type: 'fieldset', fields: { name: { type: 'text' }, amount: { type: 'number' } } }
const twoRows = { a: 'lines[0].name', b: 'lines[0].amount', c: 'lines[1].name', d: 'lines[1].amount' }

describe('a list a PDF layer binds by row', () => {
	it('passes when maxItems is within the bound rows', () => {
		expect(validate(artifact({ type: 'list', maxItems: 2, item: line }, { pdf: twoRows })).issues).toBeUndefined()
	})

	it('needs maxItems within the rows of the layer that binds the fewest', () => {
		const issues = validate(artifact({ type: 'list', maxItems: 2, item: line }, { pdf: twoRows, copy: { a: 'lines[0].name', b: 'lines[0].amount' } })).issues
		expect(issues).toEqual([expect.objectContaining({
			path: ['layers', 'copy', 'bindings'],
			message: 'Layer "copy": binds 1 row of fields.lines, and the field accepts 2 items; give it "maxItems": 1, or bind more rows.',
		})])
	})

	it('needs maxItems set', () => {
		expect(validate(artifact({ type: 'list', item: line }, { pdf: twoRows })).issues?.[0]?.message)
			.toBe('Layer "pdf": binds 2 rows of fields.lines, and the field accepts any number of items; give it "maxItems": 2, or bind more rows.')
	})

	it('refuses a gap in the rows and a later row that binds fewer members', () => {
		const gap = validate(artifact({ type: 'list', maxItems: 3, item: line }, { pdf: { a: 'lines[0].name', b: 'lines[2].name' } })).issues
		expect(gap?.map((issue) => issue.message)).toContain('Layer "pdf": binds rows of fields.lines up to row 3, but not row 2; bind every row from the first.')
		const fewer = validate(artifact({ type: 'list', maxItems: 2, item: line }, { pdf: { a: 'lines[0].name', b: 'lines[0].amount', c: 'lines[1].name' } })).issues
		expect(fewer?.map((issue) => issue.message)).toEqual(['Layer "pdf": binds amount in row 1 of fields.lines but not in row 2; bind the same members in every row.'])
	})

	it('reports the bindings of rows at or past maxItems as dead, and passes when only the rows below it are bound', async () => {
		const below = { a: 'lines[0].name', b: 'lines[0].amount', c: 'lines[1].name', d: 'lines[1].amount' }
		expect(validate(artifact({ type: 'list', maxItems: 2, item: line }, { pdf: below })).issues).toBeUndefined()
		const past = { ...below, e: 'lines[2].name', f: 'lines[3].name' }
		expect(validate(artifact({ type: 'list', maxItems: 2, item: line }, { pdf: past })).issues?.map((issue) => issue.message))
			.toEqual(['Layer "pdf": binds row 3, 4 of fields.lines, past its "maxItems": 2, so those rows never fill; remove their bindings, or raise maxItems.'])
	})

	it('counts the same rows for the gap and the members check: only those below maxItems', async () => {
		const rows = { a: 'lines[0].name', b: 'lines[0].amount', c: 'lines[2].name' }
		expect(validate(artifact({ type: 'list', maxItems: 1, item: line }, { pdf: rows })).issues?.map((issue) => issue.message))
			.toEqual(['Layer "pdf": binds row 3 of fields.lines, past its "maxItems": 1, so that row never fills; remove its bindings, or raise maxItems.'])
		expect(validate(artifact({ type: 'list', maxItems: 3, item: line }, { pdf: rows })).issues?.map((issue) => issue.message)).toEqual([
			'Layer "pdf": binds rows of fields.lines up to row 3, but not row 2; bind every row from the first.',
			'Layer "pdf": binds amount in row 1 of fields.lines but not in row 3; bind the same members in every row.',
			'Layer "pdf": binds 2 rows of fields.lines, and the field accepts 3 items; give it "maxItems": 2, or bind more rows.',
		])
	})
})
