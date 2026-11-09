import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { a, form as formApi } from '@/artifacts'
import { load } from '@/serialization'
import { validate } from '@/validation/artifact'
import { NEWER_RELEASE_HINT } from '@/validation/artifact-parsers'
import { CORE_VERSION } from '@/version'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { inspectAcroFormFields } from '@asterdoc/render/pdf'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const pdfTemplate = new Uint8Array(readFileSync(join(fixtures, 'one-field-form.pdf')))
const encoder = new TextEncoder()
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const docxTemplate = zipSync({
	'[Content_Types].xml': encoder.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
	'word/document.xml': encoder.encode('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Signed {{fields.signed}}</w:t></w:r></w:p></w:body></w:document>'),
})
const resolver = createMemoryResolver({ contents: { 'form.pdf': pdfTemplate, 'form.docx': docxTemplate, 'form.md': encoder.encode('Signed {{fields.signed}}') } })

const definition = {
	kind: 'form' as const,
	name: 'value-formats',
	version: '1.0.0',
	fields: {
		signed: { type: 'date' as const, label: 'Signed' },
		status: { type: 'enum' as const, label: 'Status', enum: [{ value: 'single' }, { value: 'married' }] },
		ssn: { type: 'text' as const, label: 'SSN', maxLength: 11 },
	},
	layers: {
		pdf: {
			kind: 'file' as const,
			mimeType: 'application/pdf',
			path: 'form.pdf',
			format: { date: { pattern: 'MM/DD/YYYY' as const } },
			bindings: { name: { path: 'signed', format: { date: { pattern: 'YYYY-MM-DD' as const } } } },
		},
		pdfCopy: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindingsFrom: 'pdf', format: { date: { pattern: 'DD/MM/YYYY' as const } } },
		pdfLayerOnly: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindings: { name: 'signed' }, format: { date: { pattern: 'DD/MM/YYYY' as const } } },
		markdown: { kind: 'inline' as const, mimeType: 'text/markdown', text: 'Signed {{fields.signed}}', format: { date: { pattern: 'YYYY-MM-DD' as const } } },
		markdownFile: { kind: 'file' as const, mimeType: 'text/markdown', path: 'form.md', format: { date: { pattern: 'DD/MM/YYYY' as const } } },
		docx: { kind: 'file' as const, mimeType: DOCX, path: 'form.docx', format: { date: { pattern: 'MM/DD/YYYY' as const } } },
		docxPlain: { kind: 'file' as const, mimeType: DOCX, path: 'form.docx' },
	},
	defaultLayer: 'pdf',
}

const filled = () => a.form(definition, { resolver }).fill({ fields: { signed: '2021-06-05' } })
const box = async (bytes: unknown) => (await inspectAcroFormFields(bytes as Uint8Array)).find((field) => field.name === 'name')?.value
const docxText = (bytes: unknown) => [...new TextDecoder().decode(unzipSync(bytes as Uint8Array)['word/document.xml']).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join('')

describe('formats on an artifact layer and its bindings', () => {
	test('a binding format overrides its layer format', async () => {
		expect(await box(await filled().render({ layer: 'pdf' }))).toBe('2021-06-05')
		expect(await box(await filled().render({ layer: 'pdfLayerOnly' }))).toBe('05/06/2021')
	})

	test('a layer reusing bindings takes each binding format, and keeps its own layer format', async () => {
		expect(await box(await filled().render({ layer: 'pdfCopy' }))).toBe('2021-06-05')
		expect(await box(await filled().render({ layer: 'pdfCopy', bindings: { name: 'signed' } }))).toBe('05/06/2021')
	})

	test('a binding object passed at render time is laid over the layer bindings', async () => {
		const bindings = { name: { path: 'signed', format: { date: { pattern: 'DD/MM/YYYY' as const } } } }
		expect(await box(await filled().render({ layer: 'pdf', bindings }))).toBe('05/06/2021')
	})

	test('a binding object passed at render time is checked as a layer binding is', async () => {
		await expect(filled().render({ layer: 'pdf', bindings: { name: { path: 'signed', format: { date: { pattern: 'D/M/YY' } } } } as never }))
			.rejects.toThrow('binding "name", is not a valid binding object')
		await expect(filled().render({ layer: 'pdf', bindings: { name: { path: 'signed', part: 'year' } } as never })).rejects.toThrow('part')
	})

	test('a text layer applies its format, inline and from a file', async () => {
		expect(await filled().render({ layer: 'markdown' })).toBe('Signed 2021-06-05')
		expect(await filled().render({ layer: 'markdownFile' })).toBe('Signed 05/06/2021')
	})

	test('a DOCX layer applies its format, and one without a format prints as before', async () => {
		expect(docxText(await filled().render({ layer: 'docx' }))).toBe('Signed 06/05/2021')
		expect(docxText(await filled().render({ layer: 'docxPlain' }))).toBe('Signed Jun 5, 2021')
	})

	test('the file layer builder takes binding objects', () => {
		const built = formApi().name('built').field('signed', { type: 'date', label: 'Signed' })
			.fileLayer('pdf', { mimeType: 'application/pdf', path: 'form.pdf', format: { locale: 'en-US' }, bindings: { name: { path: 'signed', format: { date: { pattern: 'YYYY-MM-DD' } } } } })
			.inlineLayer('notes', { mimeType: 'text/plain', text: '{{fields.signed}}', format: { date: { pattern: 'MM/DD/YYYY' } } })
			.build()
		expect(built.layers?.pdf).toMatchObject({ format: { locale: 'en-US' }, bindings: { name: { path: 'signed' } } })
		expect(built.layers?.notes).toMatchObject({ format: { date: { pattern: 'MM/DD/YYYY' } } })
	})
})

describe('validating binding formats', () => {
	const pdfForm = (bindings: Record<string, unknown>) => ({
		...definition,
		layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'form.pdf', bindings } },
	})

	test('refuses a format on an option test, naming the binding', () => {
		const result = validate(pdfForm({ married: { path: 'status:married', format: { locale: 'en-US' } } }))
		expect(result.issues).toEqual([{
			message: 'Layer "pdf", binding "married": Binding "status:married" sets a format on the option test "status:married", which fills a checkbox and prints no value.',
			path: ['layers', 'pdf', 'bindings', 'married'],
		}])
	})

	test('refuses a format on a split part, naming the binding', () => {
		const result = validate(pdfForm({ ssnMiddle: { path: 'ssn:2', format: { locale: 'en-US' } } }))
		expect(result.issues).toEqual([{
			message: 'Layer "pdf", binding "ssnMiddle": Binding "ssn:2" sets a format on the split part "ssn:2", which prints a piece of the raw value.',
			path: ['layers', 'pdf', 'bindings', 'ssnMiddle'],
		}])
	})

	test('accepts a format on a value, and a split part or an option test with none', () => {
		const result = validate(pdfForm({
			signed: { path: 'signed', format: { date: { pattern: 'MM/DD/YYYY' } } },
			ssn: { path: 'ssn:2' },
			married: { path: 'status:married' },
		}))
		expect(result.issues).toBeUndefined()
	})

	test('checks a binding object path as it checks a string', () => {
		const result = validate(pdfForm({ name: { path: 'fields.nickname', format: {} } }))
		expect(result.issues?.[0]?.message).toContain('"fields.nickname" is not a known Asterdoc path')
	})
})

describe('an unknown key in a current artifact', () => {
	const artifact = (layer: Record<string, unknown>) => JSON.stringify({
		$schema: ASTERDOC_SCHEMA_URL,
		kind: 'form',
		name: 'hint',
		fields: { signed: { type: 'date', label: 'Signed' } },
		layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'form.pdf', ...layer } },
	})

	test('says the key may come from a newer release than this core', () => {
		expect(NEWER_RELEASE_HINT).toBe(`This key may come from a newer Asterdoc release than @asterdoc/core ${CORE_VERSION}. Update the SDK.`)
		expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
		expect(() => load(artifact({ format: { money: { fractionDigits: 0 } } }))).toThrow(NEWER_RELEASE_HINT)
	})

	test('carries no hint for another fault, or for an artifact without $schema', () => {
		expect(() => load(artifact({ format: { date: { pattern: 'D/M/YY' } } }))).toThrow(/Invalid/)
		expect(() => load(artifact({ format: { date: { pattern: 'D/M/YY' } } }))).not.toThrow(NEWER_RELEASE_HINT)
		const unversioned = JSON.parse(artifact({ format: { money: { fractionDigits: 0 } } })) as Record<string, unknown>
		delete unversioned.$schema
		expect(() => a.form(unversioned as never)).toThrow(/Unrecognized key/)
		expect(() => a.form(unversioned as never)).not.toThrow(NEWER_RELEASE_HINT)
	})
})
