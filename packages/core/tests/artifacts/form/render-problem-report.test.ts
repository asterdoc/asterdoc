import { describe, expect, test } from 'vitest'
import { renderProblemReport } from '@/artifacts'

describe('a render problem has one reported shape', () => {
	test('a problem with a PDF field names the path, keyword render, code, layer and PDF field', () => {
		expect(renderProblemReport({ field: 'fields.name', message: 'Layer "pdf": too long', code: 'unprintable', layer: 'pdf', pdfField: 'name_box' })).toEqual({
			path: 'fields.name',
			keyword: 'render',
			code: 'unprintable',
			message: 'Layer "pdf": too long',
			layer: 'pdf',
			pdf_field: 'name_box',
		})
	})

	test('a problem with no PDF field leaves pdf_field out', () => {
		expect(renderProblemReport({ field: 'layers.pdf', message: 'Layer "pdf": no font', code: 'unprintable', layer: 'pdf' })).not.toHaveProperty('pdf_field')
	})
})
