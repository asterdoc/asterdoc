import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runCli } from '../setup/spawn-cli.js'

const root = mkdtempSync(path.join(tmpdir(), 'asterdoc-cli-101-'))
const file = path.join(root, 'bad.json')
writeFileSync(file, JSON.stringify({ $schema: 'https://schema.asterdoc.com/2026-10-28.json', kind: 'form', name: 'bad', title: 'Bad', version: '1.0.0', fields: { a: { type: 'nope', label: 'A' } } }))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('asterdoc-cli-101: scope flags require a schema-valid artifact', () => {
  it('--checksum-only fails', async () => {
    const result = await runCli(['validate', file, '--checksum-only', '--json'], { cwd: root })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).ok).toBe(false)
  })
})
