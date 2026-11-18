import { describe, expect, it } from 'vitest'
import { form, validateLayers } from '@/index'

const encoder = new TextEncoder()

function fieldsPdf(names: string[], width: (index: number) => number = (index) => 60 + index * 60): Uint8Array {
	const refs = names.map((_, index) => `${index + 4} 0 R`).join(' ')
	const objects = [
		`<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${refs}] /DA (/Helv 0 Tf 0 g) >> >>`,
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [${refs}] >>`,
		...names.map((name, index) => `<< /FT /Tx /T (${name}) /Subtype /Widget /Rect [20 700 ${20 + width(index)} 714] /P 3 0 R /DA (/Helv 10 Tf 0 g) >>`),
	]
	let text = '%PDF-1.5\n'
	const offsets: number[] = []
	objects.forEach((body, index) => {
		offsets.push(text.length)
		text += `${index + 1} 0 obj\n${body}\nendobj\n`
	})
	const xref = text.length
	text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
	text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return encoder.encode(text)
}

const template = fieldsPdf(['city', 'note', 'memo', 'remark'])

const definition = (fields: Record<string, unknown>, bindings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	kind: 'form' as const,
	name: 'no-values',
	version: '1.0.0',
	title: 'No values',
	fields,
	...extra,
	layers: { pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', bindings } },
	defaultLayer: 'pdf',
})

const text = (value?: string, extra: Record<string, unknown> = {}) => ({ type: 'text' as const, label: 'Text', maxLength: 12, ...(value !== undefined && { default: value }), ...extra })

const issuesOf = async (artifact: unknown, read: (path: string) => Promise<Uint8Array> = async () => template) => (await validateLayers(artifact, { resolver: { read } })).issues ?? []

const noValueIssues = async (artifact: unknown, read?: (path: string) => Promise<Uint8Array>) =>
	(await issuesOf(artifact, read)).filter((issue) => issue.message.includes('with no values given'))

describe('the render check of the form with no values given', () => {
	it('accepts defaults the layer can print', async () => {
		expect(await issuesOf(definition(
			{ city: text('Lyon'), office: { type: 'fieldset', label: 'Office', fields: { note: text('Front') } } },
			{ city: 'city', note: 'office.note' },
		))).toEqual([])
	})

	it('refuses a default a field\'s font cannot draw, at the path the render check names', async () => {
		expect(await noValueIssues(definition({ city: text('Zażółć') }, { city: 'city' }))).toEqual([{
			message: expect.stringMatching(/^Layer "pdf", with no values given: .*"city".*no available font can draw "ż"/),
			path: ['fields', 'city'],
			severity: 'error',
		}])
	})

	it('refuses a default too long for its box, in a field set no value gives', async () => {
		const office = { type: 'fieldset', label: 'Office', fields: { note: text('WWWWWWWWWWWW') } }
		expect(await noValueIssues(definition({ office }, { city: 'office.note' }))).toEqual([expect.objectContaining({
			message: expect.stringMatching(/^Layer "pdf", with no values given: .*"city"/),
			path: ['fields', 'office', 'note'],
		})])
	})

	it('refuses two defaults that fit alone but not together in one template', async () => {
		const bindings = { city: { template: '{{fields.a}}{{fields.b}}' } }
		expect(await noValueIssues(definition({ a: text('WWWWWW'), b: text('WWWWWW') }, bindings))).toHaveLength(1)
		expect(await noValueIssues(definition({ a: text('WW'), b: text('WW') }, bindings))).toEqual([])
	})

	it('refuses a computed value of two defaults that does not fit', async () => {
		const defs = { defs: { both: { type: 'string', value: 'fields.a + fields.b' } } }
		expect(await noValueIssues(definition({ a: text('WWWWWW'), b: text('WWWWWW') }, { city: 'defs.both' }, defs))).toHaveLength(1)
		expect(await noValueIssues(definition({ a: text('WW'), b: text('WW') }, { city: 'defs.both' }, defs))).toEqual([])
	})

	it('refuses a computed value that prints a default only when another default says so', async () => {
		const defs = { defs: { shown: { type: 'string', value: "fields.flag ? fields.a : ''" } } }
		const form = (flag: boolean) => definition({ flag: { type: 'boolean', label: 'Flag', default: flag }, a: text('Zażółć') }, { memo: 'defs.shown' }, defs)
		expect(await noValueIssues(form(true))).toHaveLength(1)
		expect(await noValueIssues(form(false))).toEqual([])
	})

	it('refuses constant text a template prints that no font can draw', async () => {
		expect(await noValueIssues(definition({ city: text() }, { memo: { template: 'Zażółć' } }))).toHaveLength(1)
		expect(await noValueIssues(definition({ city: text() }, { memo: { template: 'Zone' } }))).toEqual([])
	})

	it('does not see a default that applies only under other input: a render with that input refuses it', async () => {
		const remark = text('Zażółć', { visible: 'fields.remote == true' })
		const artifact = definition({ remote: { type: 'boolean', label: 'Remote' }, remark }, { remark: 'remark' })
		const loaded = await form.load(artifact, { resolver: { read: async () => template } })

		expect(await noValueIssues(artifact)).toEqual([])
		expect(loaded.fill({ fields: { remote: true } } as never).renderProblems('pdf')).toHaveLength(1)
	})

	const twoLayers = (fields: Record<string, unknown>, pdf: Record<string, unknown>, other: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
		...definition(fields, {}),
		...extra,
		layers: {
			pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', ...pdf },
			other: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', ...other },
		},
	})
	const onLayer = (issues: ReadonlyArray<{ path?: unknown }>, layer: string) =>
		issues.filter((issue) => Array.isArray(issue.path) && issue.path[0] === 'layers' && issue.path[1] === layer)
	const checksumMismatch = { checksum: `sha256:${'0'.repeat(64)}` }

	it('checks a good layer beside a layer whose checksum does not match, which gets only its own error', async () => {
		const issues = await issuesOf(twoLayers({ city: text('Zażółć') }, { bindings: { city: 'city' } }, { ...checksumMismatch, bindings: { city: 'city' } }))

		expect(issues.filter((issue) => issue.message.startsWith('Layer "pdf", with no values given:'))).toEqual([expect.objectContaining({ path: ['fields', 'city'] })])
		expect(onLayer(issues, 'other')).toEqual([expect.objectContaining({ message: expect.stringMatching(/^Layer "other" .*does not match its checksum/) })])
		expect(issues.filter((issue) => issue.message.includes('"other"') && !issue.message.startsWith('Layer "other"'))).toEqual([])
	})

	it('checks a layer with a fit error beside a layer that names a PDF field the template does not have', async () => {
		const fitError = { bindings: { note: 'city', city: { template: '{{fields.a}}{{fields.a}}{{fields.a}}' } } }
		const issues = await issuesOf(twoLayers({ city: text('Zażółć'), a: text() }, fitError, { bindings: { absent_box: 'city' } }))

		expect(issues.filter((issue) => issue.message.startsWith('Layer "pdf", with no values given:'))).toHaveLength(1)
		expect(onLayer(issues, 'pdf')).toEqual([expect.objectContaining({ path: ['layers', 'pdf', 'bindings', 'city'] })])
		expect(onLayer(issues, 'other')).toHaveLength(1)
		expect(onLayer(issues, 'other')[0]).toMatchObject({ message: expect.stringContaining('absent_box') })
	})

	const fitError = { note: 'city', city: { template: '{{fields.a}}{{fields.a}}{{fields.a}}' } }

	it('reports both a fit error and a checksum mismatch on one layer', async () => {
		const artifact = { ...definition({ city: text('Lyon'), a: text() }, fitError), layers: { pdf: { kind: 'file' as const, mimeType: 'application/pdf', path: 'form.pdf', ...checksumMismatch, bindings: fitError } } }
		const issues = await issuesOf(artifact)

		expect(onLayer(issues, 'pdf')).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: ['layers', 'pdf', 'bindings', 'city'] }),
			expect.objectContaining({ path: ['layers', 'pdf'], message: expect.stringMatching(/^Layer "pdf" cannot be read for the render check: .*does not match its checksum/) }),
		]))
	})

	it('puts the checksum issue on the layer that has the mismatch, beside a layer with its own error', async () => {
		const withFit = await issuesOf(twoLayers({ city: text('Lyon'), a: text() }, { bindings: fitError }, { ...checksumMismatch, bindings: { city: 'city' } }))
		const unreadFont = { font: { path: 'fonts/missing.ttf' }, bindings: { city: 'city' } }
		const read = async (path: string) => {
			if (path.endsWith('.ttf')) throw new Error(`no file at ${path}`)
			return template
		}
		const withFont = await issuesOf(twoLayers({ city: text('Lyon') }, unreadFont, { ...checksumMismatch, bindings: { city: 'city' } }), read)

		for (const issues of [withFit, withFont]) {
			expect(onLayer(issues, 'other')).toEqual([expect.objectContaining({ path: ['layers', 'other'], message: expect.stringContaining('does not match its checksum') })])
			expect(onLayer(issues, 'pdf').some((issue) => (issue as { message: string }).message.includes('checksum'))).toBe(false)
		}
	})

	it('reports a valid test that a good layer cannot print beside a layer that cannot be read', async () => {
		const tests = { tests: [{ name: 'polish', input: { fields: { city: 'Zażółć' } }, expect: { valid: true } }] }
		const issues = await issuesOf(twoLayers({ city: text() }, { bindings: { city: 'city' } }, { ...checksumMismatch, bindings: { city: 'city' } }, tests))

		expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/^Layer "pdf", test "polish": a render of the values of this test fails\./) })]))
		expect(onLayer(issues, 'other')).toHaveLength(1)
	})

	it('checks a form of sixteen hundred bound defaults in one render check', async () => {
		const names = Array.from({ length: 1600 }, (_, index) => `f${index}`)
		const wide = fieldsPdf(names, () => 200)
		const artifact = definition(
			Object.fromEntries(names.map((name) => [name, text(`v${name}`)])),
			Object.fromEntries(names.map((name) => [name, name])),
		)
		const started = performance.now()

		expect(await issuesOf(artifact, async () => wide)).toEqual([])
		expect(performance.now() - started).toBeLessThan(15000)
	}, 30000)
})
