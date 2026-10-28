import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runCli } from '../setup/spawn-cli.js'

const root = mkdtempSync(path.join(tmpdir(), 'asterdoc-cli-102-'))
const file = path.join(root, 'form.json')
writeFileSync(file, JSON.stringify({ $schema: 'https://schema.asterdoc.com/2026-10-28.json', kind: 'form', name: 'form', title: 'Form', version: '1.0.0', fields: {}, instructions: { kind: 'file', mimeType: 'text/markdown', path: 'missing.md' } }))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('checksum-only skips missing content files', () => {
  it('matches the missing-layer behavior', async () => {
    const result = await runCli(['validate', file, '--checksum-only', '--json'], { cwd: root })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).errors).toEqual([])
  })
})
