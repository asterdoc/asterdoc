import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../setup/spawn-cli'

const narrowField = () => {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Annots [4 0 R] >>',
    '<< /FT /Tx /T (name) /Subtype /Widget /Rect [20 700 80 714] /P 3 0 R /DA (/Helv 10 Tf 0 g) >>',
    '<< /Fields [4 0 R] >>',
  ]
  let pdf = '%PDF-1.5\n'
  const offsets: number[] = []
  bodies.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

const artifact = {
  $schema: 'https://schema.asterdoc.com/2026-11-17.json',
  kind: 'form',
  name: 'applicant',
  version: '1.0.0',
  title: 'Applicant',
  fields: { name: { type: 'text', label: 'Name', required: true, maxLength: 80 } },
  defaultLayer: 'pdf',
  layers: {
    pdf: { kind: 'file', mimeType: 'application/pdf', path: 'form.pdf', bindings: { name: 'name' } },
    summary: { kind: 'inline', mimeType: 'text/plain', text: 'Name: {{fields.name}}' },
  },
}

const LONG = JSON.stringify({ fields: { name: 'Maximilian Alexander von Hohenzollern' } })

describe('data validation and the render check of a layer', () => {
  let dir: string
  let formFile: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-render-check-'))
    formFile = path.join(dir, 'applicant.json')
    await fs.writeFile(path.join(dir, 'form.pdf'), narrowField(), 'latin1')
    await fs.writeFile(formFile, JSON.stringify(artifact))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('takes a long value as valid data, and renders it on the text layer', async () => {
    const validated = await runCli(['data', 'validate', formFile, LONG])
    expect(validated.exitCode, validated.stderr).toBe(0)
    const rendered = await runCli(['render', formFile, '--data', LONG, '--layer', 'summary'])
    expect(rendered.exitCode, rendered.stderr).toBe(0)
    expect(rendered.stdout).toContain('Name: Maximilian Alexander von Hohenzollern')
  })

  it('refuses it on the PDF layer with --render-check, and render refuses with the same report', async () => {
    const checked = await runCli(['data', 'validate', formFile, LONG, '--render-check', 'pdf', '--json'])
    expect(checked.exitCode).toBe(1)
    const check = JSON.parse(checked.stdout) as { success: boolean; renderProblems: Array<{ field: string; layer: string; pdfField: string; message: string }> }
    expect(check.success).toBe(false)
    expect(check.renderProblems).toEqual([expect.objectContaining({ field: 'fields.name', layer: 'pdf', pdfField: 'name', message: expect.stringContaining('does not fit at the minimum size') })])

    const rendered = await runCli(['render', formFile, '--data', LONG, '--out', path.join(dir, 'out.pdf'), '--format', 'json'])
    expect(rendered.exitCode).toBe(1)
    expect(JSON.parse(rendered.stdout)).toEqual({ success: false, layer: 'pdf', renderProblems: check.renderProblems })
    await expect(fs.access(path.join(dir, 'out.pdf'))).rejects.toThrow()
  })

  it('says, in the pretty report, which value does not render and why', async () => {
    const rendered = await runCli(['render', formFile, '--data', LONG, '--out', path.join(dir, 'out.pdf')])
    expect(rendered.exitCode).toBe(1)
    expect(rendered.stderr).toContain('the data is valid, but layer "pdf" cannot render it')
    expect(rendered.stderr).toContain('fields.name: Cannot fill PDF field "name" with fields.name')
  })
})
